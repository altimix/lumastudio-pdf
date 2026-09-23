import { Bold, Italic, Underline } from "lucide-react";
import type { Annotation, FontFamilyId, ShapeKind } from "../lib/types";
import { FONT_OPTIONS } from "../lib/fonts";
import { NumericField } from "./NumericField";

export function TextStyleFields({
  value,
  onChange,
  disabled,
}: {
  value: Pick<
    Annotation,
    "fontFamily" | "fontWeight" | "fontStyle" | "underline"
  >;
  onChange(change: Partial<Annotation>): void;
  disabled?: boolean;
}) {
  return (
    <fieldset className="material-style-fields" disabled={disabled}>
      <label>
        フォント
        <select
          aria-label="フォント"
          value={value.fontFamily ?? "legacy"}
          onChange={(e) =>
            onChange({ fontFamily: e.target.value as FontFamilyId })
          }
        >
          {FONT_OPTIONS.map((font) => (
            <option key={font.id} value={font.id}>
              {font.label}
            </option>
          ))}
        </select>
      </label>
      <div className="text-style-buttons" aria-label="文字の装飾">
        <button
          type="button"
          aria-label="太字"
          aria-pressed={value.fontWeight === 700}
          onClick={() =>
            onChange({ fontWeight: value.fontWeight === 700 ? 400 : 700 })
          }
        >
          <Bold size={17} />
          太字
        </button>
        <button
          type="button"
          aria-label="斜体"
          aria-pressed={value.fontStyle === "italic"}
          onClick={() =>
            onChange({
              fontStyle: value.fontStyle === "italic" ? "normal" : "italic",
            })
          }
        >
          <Italic size={17} />
          斜体
        </button>
        <button
          type="button"
          aria-label="下線"
          aria-pressed={!!value.underline}
          onClick={() => onChange({ underline: !value.underline })}
        >
          <Underline size={17} />
          下線
        </button>
      </div>
    </fieldset>
  );
}

export function ShapeStyleFields({
  value,
  onChange,
  onWidthPreview,
  onScrubStart,
  onEditingChange,
  disabled,
}: {
  value: Pick<
    Annotation,
    "shapeKind" | "strokeColor" | "fillColor" | "strokeWidth"
  >;
  onChange(change: Partial<Annotation>): void;
  onWidthPreview?(value: number | null): void;
  onScrubStart?(): void;
  onEditingChange?(editing: boolean): void;
  disabled?: boolean;
}) {
  const stroke = value.strokeColor ?? "#000000";
  const fill = value.fillColor ?? "none";
  const lineShape = value.shapeKind === "line" || value.shapeKind === "double-line";
  const visibleStroke = stroke !== "none" && (value.strokeWidth ?? 1.5) > 0;
  return (
    <fieldset
      className="material-style-fields shape-style-fields"
      disabled={disabled}
    >
      <label>
        図形の種類
        <select
          aria-label="図形の種類"
          value={value.shapeKind ?? "ellipse"}
          onChange={(e) => {
            const shapeKind = e.target.value as ShapeKind;
            onChange(shapeKind === "line" || shapeKind === "double-line"
              ? { shapeKind, strokeColor: stroke === "none" ? "#000000" : stroke, fillColor: "none", strokeWidth: Math.max(0.5, value.strokeWidth ?? 1.5) }
              : { shapeKind });
          }}
        >
          <option value="ellipse">楕円・円</option>
          <option value="rectangle">長方形</option>
          <option value="triangle">三角形</option>
          <option value="line">線</option>
          <option value="double-line">二重線（取消線）</option>
        </select>
      </label>
      <div className="shape-paint-row">
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={lineShape || stroke !== "none"}
            disabled={disabled || lineShape || (stroke !== "none" && fill === "none")}
            onChange={(e) =>
              onChange({ strokeColor: e.target.checked ? "#000000" : "none" })
            }
          />
          枠線を表示
        </label>
        <input
          type="color"
          aria-label="枠線の色"
          value={stroke === "none" ? "#000000" : stroke}
          disabled={disabled || (!lineShape && stroke === "none")}
          onChange={(e) => onChange({ strokeColor: e.target.value })}
        />
      </div>
      <label>
        枠線の太さ
        <NumericField
          aria-label="枠線の太さ"
          value={value.strokeWidth ?? 1.5}
          min={lineShape || fill === "none" ? 0.5 : 0}
          max={20}
          step={0.5}
          suffix="pt"
          disabled={disabled || (!lineShape && stroke === "none")}
          onChange={(strokeWidth) => onChange({ strokeWidth })}
          onPreview={onWidthPreview}
          onScrubStart={onScrubStart}
          onEditingChange={onEditingChange}
        />
      </label>
      {!lineShape && <div className="shape-paint-row">
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={fill !== "none"}
            disabled={disabled || (fill !== "none" && !visibleStroke)}
            onChange={(e) =>
              onChange({ fillColor: e.target.checked ? "#dbeafe" : "none" })
            }
          />
          塗りつぶし
        </label>
        <input
          type="color"
          aria-label="塗りつぶしの色"
          value={fill === "none" ? "#dbeafe" : fill}
          disabled={disabled || fill === "none"}
          onChange={(e) => onChange({ fillColor: e.target.value })}
        />
      </div>}
      <p className="help-text">
        {lineShape
          ? "線は枠線の色と太さで描画します。塗りつぶしは使いません。"
          : "図形が見えなくならないよう、枠線か塗りつぶしのどちらかを表示します。"}
      </p>
    </fieldset>
  );
}
