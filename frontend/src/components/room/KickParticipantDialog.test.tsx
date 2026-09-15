import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { KickParticipantDialog } from "./KickParticipantDialog";

describe("KickParticipantDialog", () => {
  it("uses alert-dialog semantics and explicit destructive copy", () => {
    const html = renderToStaticMarkup(
      <KickParticipantDialog name="Minh" onCancel={() => undefined} onConfirm={() => undefined} />,
    );

    expect(html).toContain('role="alertdialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('id="kick-participant-title"');
    expect(html).toContain("Minh");
  });

  it("clearly identifies a temporary one-hour ban", () => {
    const html = renderToStaticMarkup(
      <KickParticipantDialog name="Minh" action="ban" onCancel={() => undefined} onConfirm={() => undefined} />,
    );

    expect(html).toContain('id="kick-participant-description"');
    expect(html).toContain("1 giờ");
  });
});
