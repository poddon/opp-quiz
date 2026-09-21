import { createAdminToken, passwordMatches, setAdminSession } from "@/lib/admin-auth";
import { apiError, apiJson, corsOptions } from "@/lib/api";

export const OPTIONS = corsOptions;

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const username = String(body.username ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");
  if (username !== "admin" || !(await passwordMatches(password))) {
    return apiError("Неверная должность или пароль", 401);
  }
  const token = await createAdminToken();
  const response = apiJson({ ok: true, token });
  setAdminSession(response, token);
  return response;
}
