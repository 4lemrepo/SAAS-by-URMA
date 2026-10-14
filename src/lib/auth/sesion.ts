import "server-only";
import { redirect } from "next/navigation";
import { crearClienteServidor } from "@/lib/supabase/server";

export type Rol = "dueno" | "administracion" | "operador";

export interface Membresia {
  empresaId: string;
  empresaNombre: string;
  rol: Rol;
}

export interface UsuarioActual {
  id: string;
  correo: string | null;
  membresias: Membresia[];
}

/**
 * Capa de acceso: el único lugar que lee la sesión. Valida el JWT (getClaims)
 * y trae las empresas del usuario. Manda a /login si no hay sesión.
 * Las consultas van con la sesión del usuario, así que RLS aplica.
 */
export async function usuarioActual(): Promise<UsuarioActual> {
  const supabase = await crearClienteServidor();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (!claims?.sub) redirect("/login");

  const { data: filas, error } = await supabase
    .from("miembros")
    .select("empresa_id, rol, empresas(nombre)")
    .eq("usuario_id", claims.sub)
    .order("creado_en");
  if (error) throw new Error("No se pudieron leer las empresas del usuario");

  return {
    id: claims.sub,
    correo: typeof claims.email === "string" ? claims.email : null,
    membresias: (filas ?? []).map((f) => ({
      empresaId: f.empresa_id,
      empresaNombre: (f.empresas as unknown as { nombre: string } | null)?.nombre ?? "",
      rol: f.rol as Rol,
    })),
  };
}

/** Como usuarioActual, pero exige que el usuario ya pertenezca a una empresa. */
export async function usuarioConEmpresa() {
  const usuario = await usuarioActual();
  const [empresa] = usuario.membresias;
  if (!empresa) redirect("/alta-empresa");
  return { ...usuario, empresa };
}
