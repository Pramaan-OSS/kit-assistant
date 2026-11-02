import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Button, Card, EmptyState, Field } from "./ui";

const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);

describe("ui parts", () => {
  it("EmptyState shows its message and one primary action", () => {
    const out = html(
      createElement(EmptyState, {
        title: "No items",
        action: { label: "Add item", onClick: () => {} },
      }),
    );
    expect(out).toContain("No items");
    expect(out.match(/button-primary/g)).toHaveLength(1);
    expect(out).toContain("Add item");
  });

  it("Button defaults to secondary and Card uses the card class", () => {
    expect(html(createElement(Button, null, "Go"))).toContain("button-secondary");
    expect(html(createElement(Card, null, "x"))).toContain('class="card ');
  });

  it("Field always renders a label tied to its input", () => {
    const out = html(createElement(Field, { id: "n", label: "Name" }));
    expect(out).toContain('for="n"');
    expect(out).toContain('id="n"');
    expect(html(createElement(Field, { id: "n", label: "Name", className: "mt-2" }))).toContain(
      "mt-2",
    );
  });
});
