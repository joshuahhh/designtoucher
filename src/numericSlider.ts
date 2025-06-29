// numericSlider.ts — CodeMirror 6 plugin: inline sliders for numeric literals
import { RangeSetBuilder } from "@codemirror/state";
import {
  Decoration,
  DecorationSet,
  EditorView,
  ViewPlugin,
  ViewUpdate,
  WidgetType,
} from "@codemirror/view";

/* ── super-simple decimal / float regex ── */
const numberRE = /\b\d+(?:\.\d+)?\b/g;

/* ── slider widget ── */
class SliderWidget extends WidgetType {
  constructor(
    private literal: string, // current textual value
    private startPos: number, // offset where the literal starts
  ) {
    super();
  }

  /* Always return false so CodeMirror asks updateDOM whether it can keep the
     existing element instead of re-creating it. */
  eq() {
    return false;
  }

  /* Called when eq() is false; update the element in place and keep it. */
  updateDOM(dom: HTMLElement): boolean {
    const input = dom as HTMLInputElement;
    if (input.value !== this.literal) {
      input.value = this.literal;
      input.max = (Number(this.literal) * 2 || 100).toString();
      input.step = this.literal.includes(".") ? "0.01" : "1";
    }
    return true; // tell CM it may reuse this dom node
  }

  toDOM(view: EditorView): HTMLElement {
    const input = document.createElement("input");
    input.type = "range";
    input.min = "0";
    input.max = (Number(this.literal) * 2 || 100).toString();
    input.step = this.literal.includes(".") ? "0.01" : "1";
    input.value = this.literal;
    input.style.cssText = "width:60px;margin-left:4px";

    // length of the literal currently in the doc (updates as we drag)
    let currentLen = this.literal.length;

    input.addEventListener("input", () => {
      const from = this.startPos;
      const to = from + currentLen;
      view.dispatch({ changes: { from, to, insert: input.value } });
      this.literal = input.value; // sync widget state
      currentLen = input.value.length;
    });

    return input;
  }

  ignoreEvent() {
    return true;
  } // editor shouldn’t steal slider events
}

/* ── build decorations for entire document ── */
function buildDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  let pos = 0;
  for (const iter = view.state.doc.iter(); !iter.done; iter.next()) {
    numberRE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = numberRE.exec(iter.value))) {
      const start = pos + m.index;
      const end = start + m[0].length;
      builder.add(
        end,
        end, // widget just after the literal
        Decoration.widget({
          side: 1,
          widget: new SliderWidget(m[0], start),
        }),
      );
    }
    pos += iter.value.length;
  }
  return builder.finish();
}

/* ── plugin ── */
export const numericSlider = () =>
  ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(readonly view: EditorView) {
        this.decorations = buildDecorations(view);
      }

      update(u: ViewUpdate) {
        if (u.docChanged || u.viewportChanged) {
          // Always rebuild; updateDOM ensures the existing element is kept.
          this.decorations = buildDecorations(this.view);
        }
      }
    },
    { decorations: (v) => v.decorations },
  );

/* ── example usage ──
import {basicSetup, EditorState} from "@codemirror/basic-setup";
new EditorView({
  state: EditorState.create({
    doc: "let size = 42;\nconst opacity = 0.5;",
    extensions: [basicSetup, numericSlider()]
  }),
  parent: document.body
});
*/
