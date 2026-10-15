import { NextResponse, type NextRequest } from "next/server";
import { crearClienteServidor } from "@/lib/supabase/server";

const MOTIVOS = new Set(["sin_confirmar", "confirmacion_apagada"]);

/**
 * Cierra la sesión de un usuario que no debe estar dentro (correo sin confirmar,
 * confirmación apagada) y lo manda al login con el motivo. Las páginas no pueden
 * borrar cookies, por eso usuarioActual() redirige aquí.
 */
export async function GET(request: NextRequest) {
  const supabase = await crearClienteServidor();
  await supabase.auth.signOut();

  const motivo = request.nextUrl.searchParams.get("motivo") ?? "";
  const destino = new URL("/login", request.url);
  if (MOTIVOS.has(motivo)) destino.searchParams.set("error", motivo);
  return NextResponse.redirect(destino);
}
