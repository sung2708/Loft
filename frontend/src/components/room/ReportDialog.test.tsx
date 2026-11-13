import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ReportDialog } from "./ReportDialog";

const credential = {
  type: "guest" as const,
  token: "t",
  roomId: "room-1",
  displayName: "Guest",
};

describe("ReportDialog", () => {
  it("names the person, offers every reason and starts with Send disabled", () => {
    const html = renderToStaticMarkup(
      <ReportDialog
        roomId="room-1"
        credential={credential}
        target={{ type: "user", id: "u2", name: "Minh" }}
        onClose={() => undefined}
      />,
    );
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain("Minh");
    expect(html.match(/type="radio"/g)).toHaveLength(5);
    expect(html).toMatch(/<button type="submit" disabled=""/);
    expect(html).toContain('maxLength="1000"');
  });

  it("titles a room report without a person's name", () => {
    const html = renderToStaticMarkup(
      <ReportDialog
        roomId="room-1"
        credential={credential}
        target={{ type: "room", id: "room-1", name: "Hangout" }}
        onClose={() => undefined}
      />,
    );
    expect(html).toMatch(/Report this room|Báo cáo phòng này/);
  });
});
