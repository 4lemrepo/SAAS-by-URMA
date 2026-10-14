import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { rutaSegura } from "@/lib/auth/validacion";
import { crearClienteServidor } from "@/lib/supabase/server";

const TIPOS_OTP: EmailOtpType[] = ["signup", "invite", "magiclink", "recovery", "email_change", "email"];

/**
 * Destino del enlace del correo de confirmación. Acepta los dos formatos de Supabase:
 * ?code=… (flujo PKCE, el predeterminado de @supabase/ssr) o ?token_hash=…&type=…
 * (plantilla de correo personalizada). Deja la sesión en cookies y redirige.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const siguiente = rutaSegura(searchParams.get("siguiente"), "/alta-empresa");
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const tipo = searchParams.get("type") as EmailOtpType | null;

  const supabase = await crearClienteServidor();
  let ok = false;
  if (code) {
    ok = !(await supabase.auth.exchangeCodeForSession(code)).error;
  } else if (tokenHash && tipo && TIPOS_OTP.includes(tipo)) {
    ok = !(await supabase.auth.verifyOtp({ type: tipo, token_hash: tokenHash })).error;
  }

  // rutaSegura garantiza que `siguiente` es una ruta interna.
  return NextResponse.redirect(new URL(ok ? siguiente : "/login?error=confirmacion", request.url));
}
