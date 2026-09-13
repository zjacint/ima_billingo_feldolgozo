"use client";

import { useMemo, useRef, useState } from "react";

export interface CodeNameOption {
  code: string;
  name: string;
}

/**
 * Szabad szöveges input, ami — ha van hozzá betöltött lista (pl. az IMA
 * API-ból lekért számlatükör/áfa kulcs lista) — kód vagy név alapján
 * szűrt javaslatokat ajánl fel kattintásra. A mező értéke mindig a kód
 * marad (ez kerül mentésre), a javaslatlista csak kényelmi funkció — üres
 * `options` esetén sima szövegmezőként viselkedik, és gépeléssel
 * bármilyen érték megadható a listán kívül is.
 */
export default function CodeNameCombobox({
  value,
  onChange,
  options,
  placeholder,
  disabled,
  style,
  inputMode,
  onBlur,
}: {
  value: string;
  onChange: (value: string) => void;
  options: CodeNameOption[];
  placeholder?: string;
  disabled?: boolean;
  style?: React.CSSProperties;
  inputMode?: "text" | "numeric";
  onBlur?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const blurTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const matches = useMemo(() => {
    const q = value.trim().toLowerCase();
    if (!q) return options.slice(0, 20);
    return options
      .filter((o) => o.code.toLowerCase().includes(q) || o.name.toLowerCase().includes(q))
      .slice(0, 20);
  }, [value, options]);

  function select(option: CodeNameOption) {
    onChange(option.code);
    setOpen(false);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || matches.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlighted((i) => Math.min(i + 1, matches.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlighted((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      select(matches[highlighted]!);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div style={{ position: "relative", ...style }}>
      <input
        type="text"
        inputMode={inputMode}
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        style={{ width: "100%" }}
        onChange={(e) => {
          onChange(e.target.value);
          setHighlighted(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
        onBlur={() => {
          // Kis késleltetés, hogy a lenyíló listára kattintás (ami blur-t
          // is kivált) még feldolgozódjon a bezárás előtt.
          blurTimeout.current = setTimeout(() => setOpen(false), 150);
          onBlur?.();
        }}
      />
      {open && options.length > 0 && matches.length > 0 && (
        <ul
          className="card"
          style={{
            position: "absolute",
            zIndex: 20,
            top: "100%",
            left: 0,
            right: 0,
            marginTop: "0.25rem",
            padding: "0.25rem",
            maxHeight: "16rem",
            overflowY: "auto",
            listStyle: "none",
          }}
        >
          {matches.map((option, i) => (
            <li key={option.code}>
              <button
                type="button"
                className="btn btn-sm"
                style={{
                  width: "100%",
                  justifyContent: "flex-start",
                  textAlign: "left",
                  background: i === highlighted ? "var(--color-primary-soft)" : "transparent",
                  border: "none",
                }}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => select(option)}
                onMouseEnter={() => setHighlighted(i)}
              >
                <strong>{option.code}</strong>
                {option.name && <span className="muted"> — {option.name}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
