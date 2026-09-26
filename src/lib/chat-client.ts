import { supabase } from "@/integrations/supabase/client";

/** Ruft den Chat mit der Anmeldung des aktuellen Nutzers auf. */
export async function postChat(body: unknown, signal?: AbortSignal): Promise<Response> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return fetch("/api/chat", {
    method: "POST",
    signal,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}
