"""
Regenerate docs/diagrams/rel_*.png (one image per relationship) straight from
prisma/schema.prisma, so the thesis figures always match the database.

Usage:  python scripts/render-diagrams.py            (needs Pillow + Windows/Arial fonts)

Each image shows the two tables of a relationship with PK/FK markers, column
types, NOT NULL / NULL, joined by a Chen-style relationship diamond with crow's-foot notation.
docs/diagrams/erd.png (the entity/relationship overview) shows no columns and is
drawn separately.
"""
import re
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
SCHEMA = ROOT / "prisma" / "schema.prisma"
OUT = ROOT / "docs" / "diagrams"
FONTS = Path("C:/Windows/Fonts")

# Display names used across the thesis figures.
TITLES = {
    "UserType": "User_Type", "User": "User", "UserLog": "User_Log", "Request": "Request",
    "Notification": "Notification", "Broadcast": "Broadcast", "BroadcastDelivery": "Broadcast_Delivery",
    "Feedback": "Feedback", "Location": "Location", "LocationDetail": "Location_Details",
    "Plot": "Plot", "PlotPhoto": "Plot_Photo", "Grave": "Grave", "GraveDetail": "Grave_Details",
    "Navigation": "Navigation",
}

# file, left model, right model, relationship label, left marker, right marker
# markers: "one" = ||   "zero_one" = |O   "zero_many" = O<
RELATIONS = [
    ("rel_01_user_type_user", "UserType", "User", "Has", "one", "zero_many"),
    ("rel_02_user_user_log", "User", "UserLog", "Generates", "zero_one", "zero_many"),
    ("rel_03_user_request", "User", "Request", "Submits", "one", "zero_many"),
    ("rel_04_user_notification", "User", "Notification", "Receives", "one", "zero_many"),
    ("rel_05_request_notification", "Request", "Notification", "Triggers", "zero_one", "zero_many"),
    ("rel_06_user_broadcast", "User", "Broadcast", "Creates", "one", "zero_many"),
    ("rel_07_broadcast_notification", "Broadcast", "Notification", "Sends", "zero_one", "zero_many"),
    ("rel_08_broadcast_broadcast_delivery", "Broadcast", "BroadcastDelivery", "Has", "one", "zero_many"),
    ("rel_09_user_broadcast_delivery", "User", "BroadcastDelivery", "Receives", "one", "zero_many"),
    ("rel_10_user_feedback", "User", "Feedback", "Gives", "one", "zero_many"),
    ("rel_11_user_location", "User", "Location", "Deactivates", "zero_one", "zero_many"),
    ("rel_12_location_location_details", "Location", "LocationDetail", "Has", "one", "zero_many"),
    ("rel_13_location_details_plot", "LocationDetail", "Plot", "Contains", "one", "zero_many"),
    ("rel_14_plot_plot_photo", "Plot", "PlotPhoto", "Has", "one", "zero_many"),
    ("rel_15_plot_grave", "Plot", "Grave", "Holds", "one", "zero_many"),
    ("rel_16_grave_grave_details", "Grave", "GraveDetail", "Has", "one", "zero_one"),
    ("rel_17_user_grave", "User", "Grave", "Verifies", "zero_one", "zero_many"),
    ("rel_18_plot_navigation", "Plot", "Navigation", "Guides To", "zero_one", "zero_many"),
    ("rel_19_user_navigation", "User", "Navigation", "Requests", "zero_one", "zero_many"),
]

# ─── Parse the Prisma schema ─────────────────────────────────

SCALARS = {"Int", "String", "Boolean", "DateTime", "Decimal", "Float", "BigInt", "Json", "Bytes"}


def parse_schema(text):
    enums = {m.group(1) for m in re.finditer(r"^enum\s+(\w+)\s*\{", text, re.M)}
    enum_values = {}
    for m in re.finditer(r"^enum\s+(\w+)\s*\{(.*?)^\}", text, re.M | re.S):
        enum_values[m.group(1)] = [v.strip() for v in m.group(2).split("\n") if v.strip() and not v.strip().startswith("//")]

    models = {}
    for m in re.finditer(r"^model\s+(\w+)\s*\{(.*?)^\}", text, re.M | re.S):
        name, body = m.group(1), m.group(2)
        fk_fields = set()
        for rel in re.finditer(r"@relation\([^)]*fields:\s*\[([^\]]+)\]", body):
            fk_fields.update(x.strip() for x in rel.group(1).split(","))
        cols = []
        for line in body.split("\n"):
            line = line.split("//")[0].strip()
            lm = re.match(r"(\w+)\s+(\w+)(\?|\[\])?\s*(.*)", line)
            if not lm or line.startswith("@@"):
                continue
            fname, ftype, mod, rest = lm.groups()
            if mod == "[]" or not (ftype in SCALARS or ftype in enums):
                continue  # relation field, not a column
            mp = re.search(r'@map\("(\w+)"\)', rest)
            col = mp.group(1) if mp else fname
            cols.append({
                "name": col,
                "pk": "@id" in rest,
                "fk": fname in fk_fields,
                "null": mod == "?",
                "type": sql_type(ftype, rest, enums),
                "enum": enum_values[ftype] if ftype in enums else None,
            })
        models[name] = cols
    return models


def sql_type(ftype, rest, enums):
    if ftype in enums:
        return "ENUM"
    db = re.search(r"@db\.(\w+)(?:\(([^)]*)\))?", rest)
    if db:
        kind, arg = db.group(1), db.group(2)
        kind = {"VarChar": "VARCHAR", "Char": "CHAR", "Text": "TEXT", "TinyInt": "TINYINT",
                "Date": "DATE", "Decimal": "DECIMAL"}.get(kind, kind.upper())
        return f"{kind}({arg.replace(' ', '')})" if arg else kind
    return {"Int": "INT(11)", "Boolean": "TINYINT(1)", "DateTime": "DATETIME",
            "String": "VARCHAR(191)", "Float": "DOUBLE", "BigInt": "BIGINT"}[ftype]


# ─── Drawing (rendered at 2x then downsampled for smooth edges) ─

S = 2
TW = 760                      # table width
W = 2060                      # image width
LX, RX = 40, W - 40 - TW      # left / right table x
LR, MID = LX + TW, W // 2     # left table's right edge, diagram centre
INK = (30, 37, 54)
HEAD_BG = (229, 231, 235)
GREY = (85, 90, 105)
LABEL = (100, 105, 120)
NULL_CLR = (180, 83, 9)


def font(name, size):
    return ImageFont.truetype(str(FONTS / name), size * S)


F_TITLE, F_NAME, F_NAMEI, F_TYPE = font("arialbd.ttf", 30), font("arial.ttf", 26), font("ariali.ttf", 26), font("arial.ttf", 24)
F_NULL = font("arialbd.ttf", 19)
F_KEY, F_NOTE, F_NAMEB = font("arialbd.ttf", 22), font("arial.ttf", 20), font("arialbd.ttf", 26)

HEADER_H, ROW_H, PAD_BOTTOM, NOTE_H = 68, 48, 17, 26


def table_height(cols):
    enum_cols = [c for c in cols if c["enum"]]
    extra = (10 + NOTE_H * len(enum_cols) + 8) if enum_cols else 0
    return HEADER_H + ROW_H * len(cols) + PAD_BOTTOM + extra


def draw_table(d, x, y, title, cols):
    w, h = TW, table_height(cols)
    box = [x * S, y * S, (x + w) * S, (y + h) * S]
    d.rectangle(box, fill=(255, 255, 255), outline=INK, width=3 * S)
    d.rectangle([x * S, y * S, (x + w) * S, (y + HEADER_H) * S], fill=HEAD_BG, outline=INK, width=3 * S)
    d.text(((x + w / 2) * S, (y + 34) * S), title, font=F_TITLE, fill=INK, anchor="mm")

    for i, c in enumerate(cols):
        cy = (y + 95 + ROW_H * i) * S
        if c["pk"]:
            d.text(((x + 24) * S, cy), "PK", font=F_KEY, fill=LABEL, anchor="lm")
        elif c["fk"]:
            d.text(((x + 24) * S, cy), "FK", font=F_KEY, fill=LABEL, anchor="lm")
        name_font = F_NAMEB if c["pk"] else (F_NAMEI if c["fk"] else F_NAME)
        d.text(((x + 88) * S, cy), c["name"], font=name_font, fill=INK, anchor="lm")
        if c["pk"]:
            nb = d.textbbox(((x + 88) * S, cy), c["name"], font=name_font, anchor="lm")
            d.line([nb[0], nb[3] + 2 * S, nb[2], nb[3] + 2 * S], fill=INK, width=2 * S)
        d.text(((x + w - 24) * S, cy), c["type"], font=F_TYPE, fill=GREY, anchor="rm")
        # Nullability: PK/required columns are NOT NULL, optional ones are NULL.
        if c["null"]:
            d.text(((x + w - 236) * S, cy), "NULL", font=F_NULL, fill=NULL_CLR, anchor="rm")
        else:
            d.text(((x + w - 236) * S, cy), "NOT NULL", font=F_NULL, fill=LABEL, anchor="rm")

    enum_cols = [c for c in cols if c["enum"]]
    if enum_cols:
        ty = y + HEADER_H + ROW_H * len(cols) + PAD_BOTTOM
        d.line([(x + 20) * S, ty * S, (x + w - 20) * S, ty * S], fill=(200, 203, 210), width=1 * S)
        for i, c in enumerate(enum_cols):
            text = f"{c['name']}: " + " | ".join(c["enum"])
            d.text(((x + 24) * S, (ty + 8 + NOTE_H * i + NOTE_H / 2) * S), text, font=F_NOTE, fill=GREY, anchor="lm")
    return h


def vbar(d, x, cy, half=19):
    d.line([x * S, (cy - half) * S, x * S, (cy + half) * S], fill=INK, width=3 * S)


def circle(d, cx, cy, r=12):
    d.ellipse([(cx - r) * S, (cy - r) * S, (cx + r) * S, (cy + r) * S], fill=(255, 255, 255), outline=INK, width=3 * S)


def draw_relation(d, cy, label, left, right):
    # Spine and diamond.
    half = 105
    d.line([LR * S, cy * S, (MID - half) * S, cy * S], fill=INK, width=3 * S)
    d.line([(MID + half) * S, cy * S, RX * S, cy * S], fill=INK, width=3 * S)
    pts = [(MID, cy - 53), (MID + half, cy), (MID, cy + 53), (MID - half, cy)]
    d.polygon([(x * S, y * S) for x, y in pts], fill=(255, 255, 255), outline=INK, width=3 * S)
    d.text((MID * S, cy * S), label, font=F_TYPE, fill=INK, anchor="mm")

    # Left end (next to the left table).
    if left == "one":
        vbar(d, LR + 18, cy)
        vbar(d, LR + 34, cy)
    elif left == "zero_one":
        vbar(d, LR + 18, cy)
        circle(d, LR + 46, cy)
    # Right end (next to the right table).
    if right == "zero_many":
        circle(d, RX - 56, cy)
        for dy in (-20, 20):
            d.line([RX * S, (cy + dy) * S, (RX - 32) * S, cy * S], fill=INK, width=3 * S)
    elif right == "zero_one":
        circle(d, RX - 46, cy)
        vbar(d, RX - 18, cy)


def render(models, spec):
    fname, lm, rm, label, lk, rk = spec
    lcols, rcols = models[lm], models[rm]
    lh, rh = table_height(lcols), table_height(rcols)
    tall = max(lh, rh)
    height = 40 + tall + 39
    cy = 40 + tall // 2

    img = Image.new("RGB", (W * S, height * S), "white")
    d = ImageDraw.Draw(img)
    draw_table(d, LX, cy - lh // 2, TITLES[lm], lcols)
    draw_table(d, RX, cy - rh // 2, TITLES[rm], rcols)
    draw_relation(d, cy, label, lk, rk)
    img = img.resize((W, height), Image.LANCZOS)
    path = OUT / f"{fname}.png"
    img.save(path, optimize=True)
    return path, img.size


def main():
    models = parse_schema(SCHEMA.read_text(encoding="utf-8"))
    for spec in RELATIONS:
        for m in (spec[1], spec[2]):
            if m not in models:
                sys.exit(f"Model {m} missing from schema")
        path, size = render(models, spec)
        print(f"{path.name:46s} {size[0]}x{size[1]}")


if __name__ == "__main__":
    main()
