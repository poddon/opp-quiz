import { isAdmin } from "@/lib/admin-auth";
import { apiJson, corsOptions } from "@/lib/api";

export const OPTIONS = corsOptions;

export async function GET(request: Request) {
  const authenticated = await isAdmin(request);
  return apiJson({ authenticated }, { status: authenticated ? 200 : 401 });
}
