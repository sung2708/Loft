import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SocialActions } from "./SocialActions";

describe("SocialActions", () => {
  it("exposes an accessible collapsed trigger", () => {
    const html = renderToStaticMarkup(
      <SocialActions raised={false} onReaction={() => undefined} onWave={() => undefined} onToggleHand={() => undefined} controlClass="control" />,
    );
    expect(html).toContain('aria-haspopup="menu"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("Tương tác trong phòng");
  });
});
