import { beforeAll, afterEach, describe, expect, it, vi } from "vitest"
import { migrate } from "@/lib/db"
import { requireUser } from "@/lib/app-session"
import { GET } from "./route"
vi.mock("@/lib/app-session", () => ({ requireUser: vi.fn() }))
beforeAll(async () => {
  await migrate()
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.resetAllMocks()
})
async function authenticatedRequest(query = "") {
  vi.mocked(requireUser).mockResolvedValue({ id: "activity-user" } as Awaited<
    ReturnType<typeof requireUser>
  >)
  return GET(new Request(`http://localhost/api/activity${query}`))
}
describe("activity API", () => {
  it("returns 401 for unauthenticated requests", async () => {
    vi.mocked(requireUser).mockRejectedValue(new Error("Unauthorized"))
    expect(
      (await GET(new Request("http://localhost/api/activity"))).status
    ).toBe(401)
  })
  it("validates filters", async () => {
    expect((await authenticatedRequest("?level=invalid")).status).toBe(400)
    expect((await authenticatedRequest("?since=invalid")).status).toBe(400)
  })
  it("returns a snapshot for authenticated users", async () => {
    const response = await authenticatedRequest()
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      operations: [],
      nextCursor: null,
    })
  })
})
