#!/usr/bin/env python3
"""Convert a downloaded Colosseum Awards page to Markdown."""

import argparse
from html.parser import HTMLParser
from pathlib import Path


class Element:
    def __init__(self, tag="", attrs=(), parent=None, text=""):
        self.tag = tag
        self.attrs = dict(attrs)
        self.parent = parent
        self.children = []
        self.text = text


class PageParser(HTMLParser):
    VOID_TAGS = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.root = Element()
        self.current = self.root

    def handle_starttag(self, tag, attrs):
        element = Element(tag, attrs, self.current)
        self.current.children.append(element)
        if tag not in self.VOID_TAGS:
            self.current = element

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        if tag not in self.VOID_TAGS:
            self.handle_endtag(tag)

    def handle_endtag(self, tag):
        node = self.current
        while node is not self.root:
            if node.tag == tag:
                self.current = node.parent
                return
            node = node.parent

    def handle_data(self, data):
        self.current.children.append(Element(parent=self.current, text=data))


def descendants(node):
    for child in node.children:
        yield child
        yield from descendants(child)


def classes(node):
    return set(node.attrs.get("class", "").split())


def text(node, exclude=()):
    if node.tag in exclude:
        return ""
    if not node.tag:
        return node.text
    return " ".join(part for child in node.children if (part := text(child, exclude)))


def clean(node, exclude=()):
    return " ".join(text(node, exclude).split())


def markdown(value):
    for character in "\\`*_{}[]<>":
        value = value.replace(character, f"\\{character}")
    return value


def convert(html):
    parser = PageParser()
    parser.feed(html)
    nodes = list(descendants(parser.root))
    heading = next((n for n in nodes if n.tag == "h3" and clean(n) == "Event Awards"), None)
    if not heading:
        raise ValueError("Event Awards section not found; save the page after it has fully loaded")

    section = heading.parent
    while section is not parser.root and not (section.tag == "div" and "card" in classes(section)):
        section = section.parent

    cards = [n for n in descendants(section) if n.tag == "div" and "card" in classes(n)]
    event_name = next(
        (clean(n) for n in nodes if "event-badge-name" in classes(n) and clean(n)),
        "Event",
    )
    lines = [f"# {markdown(event_name)} Awards"]

    for card in cards:
        card_nodes = list(descendants(card))
        name = next((clean(n) for n in card_nodes if n.tag == "strong" and clean(n) != "Recipients:"), "")
        if not name:
            continue
        description = next((clean(n) for n in card_nodes if n.tag == "p"), "")
        recipients_label = next((n for n in card_nodes if n.tag == "strong" and clean(n) == "Recipients:"), None)
        recipients = []
        if recipients_label:
            recipients = [clean(n, {"button"}) for n in descendants(recipients_label.parent) if n.tag == "li"]

        lines.extend(["", f"## {markdown(name)}"])
        if description:
            lines.extend(["", markdown(description)])
        lines.extend(["", "**Recipients:**", ""])
        lines.extend(f"- {markdown(recipient)}" for recipient in recipients)
        if not recipients:
            lines.append("- None")

    if len(lines) == 1:
        raise ValueError("No event awards found")
    return "\n".join(lines) + "\n"


def self_test():
    sample = '''<span class="event-badge-name">Test Event</span><div class="card"><h3>Event Awards</h3><div><div class="card"><div><strong>Award *One*</strong><p>Good &amp; kind</p></div><div><strong>Recipients:</strong><ul><li>#1 Team One<button>×</button></li></ul></div></div><div class="card"><strong>Award Two</strong><div><strong>Recipients:</strong><span>None</span></div></div></div></div>'''
    result = convert(sample)
    assert "# Test Event Awards" in result
    assert "## Award \\*One\\*" in result
    assert "- #1 Team One" in result and "×" not in result
    assert "**Recipients:**\n\n- #1 Team One" in result
    assert result.endswith("**Recipients:**\n\n- None\n")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", nargs="?", type=Path, help="downloaded Awards HTML page")
    parser.add_argument("output", nargs="?", type=Path, help="Markdown file to create")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    if args.self_test:
        self_test()
        return
    if not args.input or not args.output:
        parser.error("input and output are required")
    args.output.write_text(convert(args.input.read_text(encoding="utf-8")), encoding="utf-8")


if __name__ == "__main__":
    main()
