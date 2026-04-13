import { acceptCompletion, completionStatus } from "@codemirror/autocomplete";
import { sql } from "@codemirror/lang-sql";
import { Compartment, EditorState, Prec } from "@codemirror/state";
import { oneDark } from "@codemirror/theme-one-dark";
import { EditorView, keymap } from "@codemirror/view";
import { basicSetup } from "codemirror";
import { useEffect, useRef } from "react";
import type { SqlSchema } from "../hooks/useCatalog";

interface EditorProps {
  value: string;
  onChange: (value: string) => void;
  onRun: () => void;
  schema?: SqlSchema;
}

function getThemeExtension() {
  const isDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  return isDark ? oneDark : [];
}

export default function Editor({ value, onChange, onRun, schema }: EditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const sqlCompartment = useRef(new Compartment());
  const themeCompartment = useRef(new Compartment());
  const onChangeRef = useRef(onChange);
  const onRunRef = useRef(onRun);

  onChangeRef.current = onChange;
  onRunRef.current = onRun;

  // biome-ignore lint/correctness/useExhaustiveDependencies: CodeMirror is imperative; value is only used for initial doc, subsequent syncs happen via the second useEffect
  useEffect(() => {
    if (!containerRef.current) return;

    const view = new EditorView({
      state: EditorState.create({
        doc: value,
        extensions: [
          basicSetup,
          sqlCompartment.current.of(sql()),
          themeCompartment.current.of(getThemeExtension()),
          Prec.highest(
            keymap.of([
              {
                key: "Mod-Enter",
                run: () => {
                  onRunRef.current();
                  return true;
                },
              },
              {
                key: "Tab",
                run: (view) => {
                  if (completionStatus(view.state) !== null) {
                    return acceptCompletion(view);
                  }
                  return false;
                },
              },
            ])
          ),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              onChangeRef.current(update.state.doc.toString());
            }
          }),
          EditorView.theme({
            "&": { height: "100%" },
            ".cm-scroller": { overflow: "auto" },
            ".cm-content": { padding: "12px 0" },
          }),
        ],
      }),
      parent: containerRef.current,
    });

    viewRef.current = view;
    return () => view.destroy();
  }, []);

  // Sync external value changes (e.g., sidebar insert)
  useEffect(() => {
    const view = viewRef.current;
    if (view && view.state.doc.toString() !== value) {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: value },
      });
    }
  }, [value]);

  // Update SQL schema when catalog data arrives
  useEffect(() => {
    const view = viewRef.current;
    if (view && schema && Object.keys(schema).length > 0) {
      view.dispatch({
        effects: sqlCompartment.current.reconfigure(sql({ schema })),
      });
    }
  }, [schema]);

  // React to OS color-scheme changes
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => {
      const view = viewRef.current;
      if (view) {
        view.dispatch({
          effects: themeCompartment.current.reconfigure(getThemeExtension()),
        });
      }
    };
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  return <div ref={containerRef} style={{ height: "100%", overflow: "auto" }} />;
}
