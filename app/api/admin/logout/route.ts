import { clearAdminSession } from "@/lib/admin-auth";
import { apiJson, corsOptions } from "@/lib/api";

export const OPTIONS = corsOptions;

export async function POST() {
  const response = apiJson({ ok: true });
  clearAdminSession(response);
  return response;
}
