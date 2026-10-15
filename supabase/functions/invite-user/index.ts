// ============================================================================
// FICA Portal — Edge Function "invite-user"
// ----------------------------------------------------------------------------
// Crea/invita a un usuario secundario por correo y le asigna permisos/empresas.
// Usa la SERVICE ROLE KEY (solo disponible del lado del servidor), por lo que
// es seguro: verifica que quien llama sea un superadmin autenticado.
//
// Cómo desplegarla (Supabase CLI):
//   supabase login
//   supabase functions deploy invite-user --no-verify-jwt
//
// Variables de entorno (las inyecta Supabase automáticamente):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//   REDIRECT_TO (opcional) -> por defecto https://portal.ayffica.com/#/set-password
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const REDIRECT_TO = Deno.env.get("REDIRECT_TO") || "https://portal.ayffica.com/#/set-password";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "Método no permitido" }, 405);
  }

  try {
    const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    // 1) Identificar al usuario que llama usando su JWT.
    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader) return json({ error: "No autorizado" }, 401);

    const caller = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });
    const { data: { user }, error: userError } = await caller.auth.getUser();
    if (userError || !user) return json({ error: "No autorizado" }, 401);

    // 2) Verificar que sea superadmin.
    const { data: profile } = await serviceClient
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();
    if (!profile || profile.role !== "superadmin") {
      return json({ error: "No autorizado" }, 403);
    }

    // 3) Leer datos de la invitación.
    const body = await req.json().catch(() => ({}));
    const email = String(body.email || "").trim().toLowerCase();
    const name = String(body.name || "").trim();
    const permissions = Array.isArray(body.permissions) ? body.permissions : [];
    const companies = Array.isArray(body.companies) ? body.companies : [];

    if (!email) return json({ error: "El correo es obligatorio" }, 400);

    // 4) Invitar al usuario (envía el correo con el enlace para crear su clave).
    const { data: inviteData, error: inviteError } = await serviceClient.auth.admin.inviteUserByEmail(
      email,
      { redirectTo: REDIRECT_TO, data: { name } }
    );

    const userId = inviteData?.user?.id;
    if (!userId) {
      return json({ error: inviteError?.message || "No se pudo invitar al usuario" }, 400);
    }

    // 5) Guardar/actualizar su perfil (nombre, email, permisos, empresas).
    await serviceClient.from("profiles").upsert({
      id: userId,
      name,
      email,
      role: "secondary",
      permissions,
      companies,
      active: true,
    });

    return json({ ok: true, id: userId });
  } catch (error) {
    return json({ error: error?.message || "Error interno" }, 500);
  }
});
