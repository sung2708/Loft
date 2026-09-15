import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ParticipantMenu } from "./ParticipantMenu";
import type { ApiParticipant } from "@/types/api";

const participant: ApiParticipant = {
  connection_id: "connection-2",
  identity_id: "user-2",
  identity_type: "user",
  display_name: "Minh",
  role: "member",
  livekit_identity: "user:user-2",
  joined_at: "2026-09-15T00:00:00Z",
};

describe("ParticipantMenu", () => {
  it("exposes an accessible menu trigger with a touch-sized action target", () => {
    const html = renderToStaticMarkup(
      <ParticipantMenu participant={participant} canTransfer onAction={() => undefined} />,
    );

    expect(html).toContain('aria-haspopup="menu"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("Minh");
    expect(html).toContain("p-2");
  });

  it("disables every moderation entry point while realtime is unavailable", () => {
    const html = renderToStaticMarkup(
      <ParticipantMenu participant={participant} canTransfer disabled onAction={() => undefined} />,
    );

    expect(html).toContain("disabled");
  });
});
