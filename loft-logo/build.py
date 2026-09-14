"""Build the Loft logo exploration and delivery assets from self-contained SVG."""

from pathlib import Path
import html
import subprocess
import zipfile


ROOT = Path(__file__).resolve().parent
INK = "#000000"
BLUE = "#0066CC"
DARK_BLUE = "#2997FF"
WHITE = "#FFFFFF"
FONT = "Segoe UI, Arial, sans-serif"


# All marks occupy the same 100 x 100 optical field. Each uses 2–4 filled forms.
MARKS = {
    "01-converge": """
      <path d="M17 27C17 20 24 16 30 19L42 27C47 31 49 36 49 43V57C49 64 47 69 42 73L30 81C24 84 17 80 17 73V27Z"/>
      <path d="M83 27C83 20 76 16 70 19L58 27C53 31 51 36 51 43V57C51 64 53 69 58 73L70 81C76 84 83 80 83 73V27Z"/>
    """,
    "02-orbit": """
      <path d="M32 19C41 14 53 13 64 17" fill="none" stroke="currentColor" stroke-width="16" stroke-linecap="round"/>
      <path d="M79 37C84 48 82 61 73 70" fill="none" stroke="currentColor" stroke-width="16" stroke-linecap="round"/>
      <path d="M56 81C43 85 30 79 23 68" fill="none" stroke="currentColor" stroke-width="16" stroke-linecap="round"/>
    """,
    "03-echo": """
      <path d="M15 57C15 51 20 47 26 48C42 52 56 49 66 37C70 32 77 32 81 36C86 41 84 48 80 53C65 72 46 77 21 69C17 68 15 63 15 57Z"/>
      <path d="M31 25C31 21 35 18 39 18C47 19 55 17 62 13C67 10 73 12 75 17C77 22 75 27 70 30C59 37 46 39 36 35C33 34 31 30 31 25Z"/>
    """,
    "04-overlap": """
      <path d="M17 29C17 23 22 18 28 18H54C62 18 68 24 68 32V48C68 55 62 61 54 61H28C22 61 17 56 17 50V29Z"/>
      <path d="M32 52C32 45 38 39 45 39H72C78 39 83 44 83 50V71C83 77 78 82 72 82H46C38 82 32 76 32 68V52Z"/>
    """,
    "05-gather": """
      <path d="M36 15C40 10 46 8 51 12L65 22C70 26 70 32 65 36L55 44C52 46 48 46 45 44L34 36C29 32 30 25 36 15Z"/>
      <path d="M17 48C15 42 19 36 25 36L38 37C42 37 45 39 47 43L50 53C51 57 50 60 47 63L36 73C30 78 23 76 20 69L17 48Z"/>
      <path d="M59 48C62 44 66 43 70 44L80 49C87 52 88 60 83 66L70 80C65 85 57 83 54 77L49 66C47 62 48 59 51 56L59 48Z"/>
    """,
}


def svg(body: str, viewbox: str, title: str, extra: str = "") -> str:
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{viewbox}" {extra}>'
        f'<title>{html.escape(title)}</title>{body}</svg>\n'
    )


def mark(name: str, color: str = INK) -> str:
    return f'<g fill="currentColor" color="{color}">{MARKS[name]}</g>'


def label(x: int, y: int, value: str, size: int = 15, color: str = INK, weight: int = 600) -> str:
    return f'<text x="{x}" y="{y}" font-family="{FONT}" font-size="{size}" font-weight="{weight}" fill="{color}">{html.escape(value)}</text>'


def placed_mark(name: str, x: float, y: float, scale: float, color: str = INK) -> str:
    return f'<g transform="translate({x} {y}) scale({scale})">{mark(name, color)}</g>'


def wordmark(x: float, y: float, size: int, color: str = INK) -> str:
    # Sans-serif text stays editable in the SVG and uses installed system fonts.
    return f'<text x="{x}" y="{y}" fill="{color}" font-family="{FONT}" font-size="{size}" font-weight="600" letter-spacing="-1">Loft</text>'


def save(path: str, data: str) -> Path:
    result = ROOT / path
    result.write_text(data, encoding="utf-8")
    return result


def raster(source: Path, width: int, height: int | None = None, target: Path | None = None) -> Path:
    target = target or source.with_suffix(".png")
    command = ["magick", "-background", "none", str(source), "-resize", f"{width}x{height or width}!", str(target)]
    subprocess.run(command, check=True)
    return target


def main() -> None:
    ROOT.mkdir(exist_ok=True)
    for name in MARKS:
        save(f"{name}.svg", svg(mark(name), "0 0 100 100", f"Loft {name} exploration"))

    # Concept sheet: consistent scale, strict monochrome, no color bias.
    board = '<rect width="1200" height="360" fill="#FFFFFF"/>'
    names = ["CONVERGE", "ORBIT", "ECHO", "OVERLAP", "GATHER"]
    for idx, (key, name) in enumerate(zip(MARKS, names)):
        x = 36 + idx * 235
        board += f'<rect x="{x}" y="40" width="214" height="266" rx="10" fill="#F6F7F8"/>'
        board += placed_mark(key, x + 42, 75, 1.3)
        board += label(x + 22, 247, f"0{idx+1}  {name}", 16)
    save("exploration.svg", svg(board, "0 0 1200 360", "Loft five concept exploration"))

    # Finalists: a three-presence cluster and a paired convergence.
    finalists = [("05-gather", "GATHER"), ("01-converge", "CONVERGE")]
    panel = '<rect width="1320" height="1300" fill="#FFFFFF"/>'
    panel += label(52, 68, "LOFT  /  TWO FINALISTS", 30)
    swatches = [("BLACK ON WHITE", INK, WHITE), ("WHITE ON BLACK", WHITE, INK),
                ("LOFT BLUE", BLUE, WHITE), ("DARK MODE", DARK_BLUE, "#111318")]
    for row, (key, display) in enumerate(finalists):
        y = 110 + row * 565
        panel += label(52, y + 8, f"0{row+1}  {display}", 20)
        for col, (caption, fg, bg) in enumerate(swatches):
            x = 52 + col * 304
            panel += f'<rect x="{x}" y="{y+30}" width="285" height="238" rx="12" fill="{bg}" stroke="#D9DEE5" stroke-width="1"/>'
            panel += placed_mark(key, x + 32, y + 58, 1.13, fg)
            panel += placed_mark(key, x + 24, y + 187, .52, fg)
            panel += wordmark(x + 88, y + 230, 40, fg)
            panel += label(x + 5, y + 293, caption, 13, "#626A74", 600)
        panel += label(52, y + 352, "FAVICON SIZE", 13, "#626A74")
        for idx, size in enumerate((16, 32, 64)):
            x = 230 + idx * 155
            panel += f'<rect x="{x}" y="{y+327}" width="92" height="92" rx="6" fill="#F1F3F5"/>'
            panel += placed_mark(key, x + (92-size)/2, y + 327 + (92-size)/2, size/100)
            panel += label(x + 33, y + 440, f"{size}px", 13, "#626A74")
    save("finalists.svg", svg(panel, "0 0 1320 1300", "Loft two finalist logo presentation"))

    winner = "05-gather"
    save("logo.svg", svg(
        f'<g transform="translate(8 8) scale(.78)">{mark(winner)}</g>' + wordmark(102, 74, 59),
        "0 0 250 100", "Loft logo"))
    save("logo-icon.svg", svg(mark(winner), "0 0 100 100", "Loft symbol"))
    save("alternate-converge-logo.svg", svg(
        f'<g transform="translate(8 8) scale(.78)">{mark("01-converge")}</g>' + wordmark(102, 74, 59),
        "0 0 250 100", "Loft alternate logo"))
    save("alternate-converge-icon.svg", svg(mark("01-converge"), "0 0 100 100", "Loft alternate symbol"))

    for name, width, height in [
        ("exploration", 2400, 720), ("finalists", 1320, 1300),
        ("logo", 1600, 640), ("logo-icon", 1024, 1024),
        ("alternate-converge-logo", 1600, 640), ("alternate-converge-icon", 1024, 1024),
    ]:
        raster(ROOT / f"{name}.svg", width, height)
    for size in (16, 24, 32, 48, 64):
        raster(ROOT / "logo-icon.svg", size, size, ROOT / f"favicon-{size}.png")
    with zipfile.ZipFile(ROOT.parent / "loft-logo.zip", "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for path in sorted(ROOT.iterdir()):
            if path.is_file():
                archive.write(path, f"loft-logo/{path.name}")


if __name__ == "__main__":
    main()
