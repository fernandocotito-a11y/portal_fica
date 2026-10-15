// ============================================================================
// FICA Portal — Edge Function "invite-user" (nuevo runtime @supabase/server)
// ----------------------------------------------------------------------------
// Invita a un usuario secundario por correo y le asigna permisos/empresas.
// auth: 'user' -> solo un usuario autenticado (el superadmin) puede llamarla.
// ============================================================================
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "jsr:@supabase/server@^1";

// redirectTo a la raíz (sin hash): Supabase añade los tokens y app.js lleva a #/set-password.
const REDIRECT_TO = "https://portal.ayffica.com/";

interface InvitePayload {
  email: string;
  name: string;
  permissions: string[];
  companies: string[];
}

export default {
  fetch: withSupabase({ auth: "user" }, async (req, ctx) => {
    // 1) Identificar al usuario que llama (JWT verificado por withSupabase).
    const callerId = ctx.userClaims?.id;
    if (!callerId) {
      return Response.json({ error: "No autorizado" }, { status: 401 });
    }

    // 2) Verificar que sea superadmin.
    const { data: profile } = await ctx.supabase
      .from("profiles")
      .select("role")
      .eq("id", callerId)
      .single();
    if (!profile || profile.role !== "superadmin") {
      return Response.json({ error: "No autorizado" }, { status: 403 });
    }

    // 3) Leer los datos de la invitación.
    let body: Partial<InvitePayload> = {};
    try {
      body = await req.json();
    } catch {
      /* body vacío */
    }

    const email = String(body.email || "").trim().toLowerCase();
    const name = String(body.name || "").trim();
    const permissions = Array.isArray(body.permissions) ? body.permissions : [];
    const companies = Array.isArray(body.companies) ? body.companies : [];

    if (!email) {
      return Response.json({ error: "El correo es obligatorio" }, { status: 400 });
    }

    // 4) Invitar al usuario (envía el correo con el enlace para crear su clave).
    const { data: inviteData, error: inviteError } =
      await ctx.supabaseAdmin.auth.admin.inviteUserByEmail(email, {
        redirectTo: REDIRECT_TO,
        data: { name },
      });

    const userId = inviteData?.user?.id;
    if (!userId) {
      return Response.json(
        { error: inviteError?.message || "No se pudo invitar al usuario" },
        { status: 400 }
      );
    }

    // 5) Guardar/actualizar su perfil (nombre, email, permisos, empresas).
    await ctx.supabaseAdmin.from("profiles").upsert({
      id: userId,
      name,
      email,
      role: "secondary",
      permissions,
      companies,
      active: true,
    });

    return Response.json({ ok: true, id: userId });
  }),
};
