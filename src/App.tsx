import { useCallback, useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import {
  ArrowDown,
  ArrowUp,
  Check,
  CheckCheck,
  ChevronLeft,
  ChevronRight,
  Download,
  FilePlus2,
  FileText,
  FolderOpen,
  Hand,
  ImagePlus,
  Info,
  KeyRound,
  LoaderCircle,
  MousePointer2,
  MoreHorizontal,
  PanelLeftClose,
  Plus,
  Printer,
  Redo2,
  Save,
  RotateCw,
  ShieldCheck,
  Shapes,
  Sparkles,
  Stamp,
  Trash2,
  Type,
  Undo2,
  Upload,
  UserRound,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import {
  annotationToDataUrl,
  appendPdfSources,
  createSamplePdf,
  exportPdf,
  loadPdf,
  renderPdfPage,
} from "./lib/pdf";
import type {
  Annotation,
  FontFamilyId,
  PageInfo,
  ShapeKind,
  Tool,
} from "./lib/types";
import {
  DEFAULT_FONT_FAMILY,
  DEFAULT_FONT_SIZE,
  ensureTextFont,
  isTextFontReady,
  measureTextHeight,
  resolveTextGeometry,
} from "./lib/fonts";
import { NumericField } from "./components/NumericField";
import {
  TextStyleFields,
  ShapeStyleFields,
} from "./components/MaterialStyleFields";
import {
  AnnotationVisual,
  PdfPage,
  Thumbnail,
  type PdfPageHandle,
} from "./components/PdfPage";
import { usePdfViewport } from "./hooks/usePdfViewport";
import { ProfileDialog, type Profile } from "./components/ProfileDialog";
import { StampImportDialog } from "./components/StampImportDialog";
import { prepareAiPage } from "./lib/ai-page";
import { SignatureDialog } from "./components/SignatureDialog";
import { MergeDialog, type MergeFile } from "./components/MergeDialog";
import { ProjectDialog } from "./components/ProjectDialog";
import { AiSettingsDialog } from "./components/AiSettingsDialog";
import { CertificateGuide } from "./components/CertificateGuide";
import { encodeProject, decodeProject } from "./lib/project";
import {
  PageContextMenu,
  type PageMenuTarget,
} from "./components/PageContextMenu";

type EditState = { pages: PageInfo[]; annotations: Annotation[] };
type Placement = {
  pageId: string;
  type: "text" | "stamp";
  field: string;
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
};
type AiResult = { placements: Placement[]; notes: string[] };
type SavedStamp = {
  id?: string;
  name: string;
  shape: "circle" | "square";
  dataUrl?: string;
  aspectRatio?: number;
};
const EMPTY: EditState = { pages: [], annotations: [] };
const today = () =>
  new Date().toLocaleDateString("ja-JP", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
function readSaved<T>(key: string, fallback: T): T {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "null") ?? fallback;
  } catch {
    return fallback;
  }
}
const STAMP_SIZE_KEY = "luma.stamp-size.v1";
function readSavedStampSize(): number {
  const value = readSaved<unknown>(STAMP_SIZE_KEY, 35);
  return typeof value === "number" && Number.isFinite(value) && value >= 8 && value <= 1000 ? value : 35;
}

export default function App() {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const original = useRef<Uint8Array | null>(null);
  const [filename, setFilename] = useState("");
  const [edits, setEdits] = useState<EditState>(EMPTY);
  const history = useRef<EditState[]>([EMPTY]);
  const cursor = useRef(0);
  const [savedState, setSavedState] = useState("");
  const [activeId, setActiveId] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tool, setTool] = useState<Tool>("select");
  const [scale, setScale] = useState(0.85);
  const [text, setText] = useState("");
  const [fontSize, setFontSize] = useState(DEFAULT_FONT_SIZE);
  const [fontFamily, setFontFamily] =
    useState<FontFamilyId>(DEFAULT_FONT_FAMILY);
  const [fontWeight, setFontWeight] = useState<400 | 700>(400);
  const [fontStyle, setFontStyle] = useState<"normal" | "italic">("normal");
  const [underline, setUnderline] = useState(false);
  const [shapeKind, setShapeKind] = useState<ShapeKind>("rectangle");
  const [strokeColor, setStrokeColor] = useState("#000000");
  const [fillColor, setFillColor] = useState("none");
  const [strokeWidth, setStrokeWidth] = useState(1.5);
  const [numericEditing, setNumericEditing] = useState(false);
  const [numericPreview, setNumericPreview] = useState<Annotation | null>(null);
  const numericPreviewRef = useRef<Annotation | null>(null);
  const flushingControls = useRef(false);
  const [color, setColor] = useState("#000000");
  const [textDraft, setTextDraft] = useState<Annotation | null>(null);
  const [textEditing, setTextEditing] = useState(false);
  const pageEditorRef = useRef<PdfPageHandle>(null);
  const editsRef = useRef(edits);
  editsRef.current = edits;
  const flushBeforeOperation = useRef<() => EditState>(() => editsRef.current);
  const [stamp, setStamp] = useState<SavedStamp>(() =>
    readSaved("luma.stamp.v1", { name: "", shape: "circle" }),
  );
  const [stampSize, setStampSize] = useState(readSavedStampSize);
  const [stampLibrary, setStampLibrary] = useState<SavedStamp[]>(() =>
    readSaved("luma.stamps.v1", []),
  );
  const [stampFile, setStampFile] = useState<File | null>(null);
  const [signatureOpen, setSignatureOpen] = useState(false);
  const [signedInput, setSignedInput] = useState(false);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [mergeFiles, setMergeFiles] = useState<MergeFile[]>([]);
  const [mergeError, setMergeError] = useState("");
  const [projectOpen, setProjectOpen] = useState(false);
  const [aiSettingsOpen, setAiSettingsOpen] = useState(false);
  const [certificateGuideOpen, setCertificateGuideOpen] = useState(false);
  const [projectError, setProjectError] = useState("");
  const projectInput = useRef<HTMLInputElement>(null);
  const [pageMenu, setPageMenu] = useState<PageMenuTarget | null>(null);
  const draggedPage = useRef<string | null>(null);
  const [draggedPageId, setDraggedPageId] = useState<string | null>(null);
  const [pageDrop, setPageDrop] = useState<{
    pageId: string;
    after: boolean;
  } | null>(null);
  const mergeInput = useRef<HTMLInputElement>(null);
  const closePageMenu = useCallback(() => setPageMenu(null), []);
  const [imageData, setImageData] = useState<{
    dataUrl: string;
    width: number;
    height: number;
  } | null>(null);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [profile, setProfile] = useState<Profile>(() =>
    readSaved("luma.profile.v1", {}),
  );
  const [profileOpen, setProfileOpen] = useState(false);
  const [printHelp, setPrintHelp] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiResult, setAiResult] = useState<AiResult | null>(null);
  const [aiSelection, setAiSelection] = useState<number[]>([]);
  const [includeStamp, setIncludeStamp] = useState(true);
  const [entryDate, setEntryDate] = useState(today());
  const [showPages, setShowPages] = useState(true);
  const pdfInput = useRef<HTMLInputElement>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const stampInput = useRef<HTMLInputElement>(null);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const placementSettings = useRef({ fontSize, stampSize, strokeWidth });
  placementSettings.current = { fontSize, stampSize, strokeWidth };
  const rememberStampSize = (value: number) => {
    if (!Number.isFinite(value)) return;
    const next = Math.round(Math.max(8, Math.min(1000, value)) * 100) / 100;
    placementSettings.current.stampSize = next;
    setStampSize(next);
    try {
      localStorage.setItem(STAMP_SIZE_KEY, JSON.stringify(next));
    } catch {
      setError("次回起動用の印鑑サイズを保存できませんでした。");
    }
  };
  const isSeal = (annotation: Annotation) => annotation.type === "stamp" || (annotation.type === "image" && annotation.stampSource === true);
  const stateKey = JSON.stringify(edits);
  const dirty =
    !!pdf && (stateKey !== savedState || textEditing || numericEditing);
  const page =
    edits.pages.find((item) => item.id === activeId) ?? edits.pages[0];
  const pageIndex = page ? edits.pages.indexOf(page) : -1;
  const selected = edits.annotations.find((item) => item.id === selectedId);
  const [, updateFontAvailability] = useState(0);
  useEffect(() => {
    if (selected?.type !== "text") return;
    let cancelled = false;
    void ensureTextFont(selected)
      .then(() => {
        if (!cancelled) updateFontAvailability((version) => version + 1);
      })
      .catch((error: unknown) => {
        if (!cancelled) setError(String(error));
      });
    return () => {
      cancelled = true;
    };
  }, [selected?.id, selected?.fontFamily]);
  const viewport = usePdfViewport({
    workspaceRef,
    scale,
    setScale,
    pageKey: page ? `${page.id}:${page.rotation}` : "",
    handTool: tool === "hand",
  });
  const currentRef = useRef({
    dirty,
    busy,
    pdf,
    signatureOpen,
    mergeOpen,
    projectOpen,
    aiSettingsOpen,
    certificateGuideOpen,
  });
  currentRef.current = {
    dirty,
    busy,
    pdf,
    signatureOpen,
    mergeOpen,
    projectOpen,
    aiSettingsOpen,
    certificateGuideOpen,
  };
  const notify = (value: string) => {
    setMessage(value);
    setError("");
  };
  const recordEdit = (next: EditState) => {
    numericPreviewRef.current = null;
    setNumericPreview(null);
    if (JSON.stringify(next) === JSON.stringify(editsRef.current)) return;
    history.current = [
      ...history.current.slice(0, cursor.current + 1),
      next,
    ].slice(-80);
    cursor.current = history.current.length - 1;
    editsRef.current = next;
    setEdits(next);
  };
  const commit = (next: EditState) => {
    if (currentRef.current.busy || signedInput) return;
    recordEdit(next);
  };
  const applyText = (annotation: Annotation) => {
    const current = editsRef.current;
    if (
      !current.pages.some((p) => p.id === annotation.pageId) ||
      signedInput ||
      busy
    )
      return current;
    const exists = current.annotations.some((a) => a.id === annotation.id);
    const cleared = !annotation.text?.trim();
    const next = {
      ...current,
      annotations: cleared
        ? current.annotations.filter((a) => a.id !== annotation.id)
        : exists
          ? current.annotations.map((a) =>
              a.id === annotation.id ? annotation : a,
            )
          : [...current.annotations, annotation],
    };
    commit(next);
    setSelectedId(cleared ? null : annotation.id);
    if (!cleared && annotation.type === "text" && !isTextFontReady(annotation)) {
      const sheet = current.pages.find((page) => page.id === annotation.pageId);
      if (sheet) void resolveTextGeometry(annotation, sheet.height)
        .then(() => {
          const active = history.current[cursor.current];
          history.current = history.current.map((entry) => {
            let changed = false;
            const annotations = entry.annotations.map((item) => {
              if (item.id !== annotation.id || item.type !== "text" ||
                  item.text !== annotation.text || item.fontFamily !== annotation.fontFamily ||
                  item.fontSize !== annotation.fontSize || item.fontWeight !== annotation.fontWeight ||
                  item.fontStyle !== annotation.fontStyle || item.underline !== annotation.underline ||
                  item.width !== annotation.width || item.height !== annotation.height) return item;
              const page = entry.pages.find((candidate) => candidate.id === item.pageId);
              if (!page) return item;
              const height = Math.min(page.height - item.y, Math.max(item.height, measureTextHeight(item)));
              if (height === item.height) return item;
              changed = true;
              return { ...item, height };
            });
            return changed ? { ...entry, annotations } : entry;
          });
          const repaired = history.current[cursor.current];
          if (repaired !== active) {
            editsRef.current = repaired;
            setEdits(repaired);
          }
        })
        .catch((error: unknown) => setError(String(error)));
    }
    return next;
  };
  const flushNumericControls = () => {
    if (!flushingControls.current) {
      flushingControls.current = true;
      try {
        const focused = document.activeElement;
        if (
          focused instanceof HTMLElement &&
          focused.matches('[data-numeric-input="true"]')
        )
          focused.blur();
        const preview = numericPreviewRef.current;
        if (preview) {
          const current = editsRef.current;
          commit({
            ...current,
            annotations: current.annotations.map((a) =>
              a.id === preview.id ? preview : a,
            ),
          });
        }
      } finally {
        flushingControls.current = false;
      }
    }
    return editsRef.current;
  };
  const flushInlineText = () => {
    flushNumericControls();
    const draft = pageEditorRef.current?.flushText();
    return draft ? applyText(draft) : editsRef.current;
  };
  flushBeforeOperation.current = flushNumericControls;
  const activatePage = (id: string) => {
    if (busy) return;
    flushInlineText();
    setActiveId(id);
    setSelectedId(null);
  };
  const undo = () => {
    if (currentRef.current.busy || signedInput) return;
    flushInlineText();
    closePageMenu();
    if (cursor.current > 0) {
      cursor.current--;
      editsRef.current = history.current[cursor.current];
      setEdits(editsRef.current);
      setSelectedId(null);
    }
  };
  const redo = () => {
    if (currentRef.current.busy || signedInput) return;
    flushInlineText();
    closePageMenu();
    if (cursor.current < history.current.length - 1) {
      cursor.current++;
      editsRef.current = history.current[cursor.current];
      setEdits(editsRef.current);
      setSelectedId(null);
    }
  };
  const changedAnnotation = (
    source: Annotation,
    change: Partial<Annotation>,
    sheet: PageInfo,
  ) => {
    const updated = { ...source, ...change };
    if (
      (source.type === "image" || source.type === "stamp") &&
      ("width" in change || "height" in change)
    ) {
      const ratio =
        "width" in change
          ? updated.width / source.width
          : updated.height / source.height;
      const bounded = Math.min(
        ratio,
        sheet.width / source.width,
        sheet.height / source.height,
      );
      updated.width = source.width * bounded;
      updated.height = source.height * bounded;
    }
    updated.width = Math.min(sheet.width, Math.max(8, updated.width));
    if (updated.type === "text")
      updated.height = Math.max(updated.height, measureTextHeight(updated));
    updated.height = Math.min(sheet.height, Math.max(8, updated.height));
    updated.x = Math.max(0, Math.min(sheet.width - updated.width, updated.x));
    updated.y = Math.max(0, Math.min(sheet.height - updated.height, updated.y));
    return updated;
  };
  const updateSelected = (change: Partial<Annotation>) => {
    if (!selectedId || currentRef.current.busy || signedInput) return;
    const current = flushInlineText();
    const source = current.annotations.find((a) => a.id === selectedId);
    const sheet = current.pages.find((p) => p.id === source?.pageId);
    if (!source || !sheet) return;
    const next = { ...source, ...change };
    const apply = () => {
      const latest = editsRef.current;
      if (!latest.annotations.some((a) => a.id === source.id)) return;
      const updated = changedAnnotation(source, change, sheet);
      recordEdit({
        ...latest,
        annotations: latest.annotations.map((a) =>
          a.id === source.id ? updated : a,
        ),
      });
      if (isSeal(source) && ("width" in change || "height" in change))
        rememberStampSize(Math.max(updated.width, updated.height));
    };
    if (next.type !== "text" || isTextFontReady(next)) apply();
    else {
      currentRef.current.busy = "フォントを読み込んでいます";
      setBusy(currentRef.current.busy);
      void ensureTextFont(next)
        .then(apply)
        .catch((error: unknown) => setError(String(error)))
        .finally(() => {
          currentRef.current.busy = "";
          setBusy("");
        });
    }
  };
  const previewSelected = (
    field: "fontSize" | "width" | "height" | "strokeWidth",
    value: number | null,
  ) => {
    const source = editsRef.current.annotations.find(
      (a) => a.id === selectedId,
    );
    const sheet = editsRef.current.pages.find((p) => p.id === source?.pageId);
    const next =
      value === null || !source || !sheet
        ? null
        : changedAnnotation(source, { [field]: value }, sheet);
    numericPreviewRef.current = next;
    setNumericPreview(next);
  };
  const removeSelected = () => {
    if (selectedId) {
      const current = flushInlineText();
      commit({
        ...current,
        annotations: current.annotations.filter(
          (item) => item.id !== selectedId,
        ),
      });
      setSelectedId(null);
    }
  };
  const deletePage = (id: string) => {
    closePageMenu();
    if (busy || signedInput || edits.pages.length <= 1) return;
    const current = flushInlineText();
    const index = current.pages.findIndex((p) => p.id === id);
    if (index < 0) return;
    const pages = current.pages.filter((p) => p.id !== id);
    commit({
      pages,
      annotations: current.annotations.filter((a) => a.pageId !== id),
    });
    const nextActiveId =
      page?.id === id ? pages[Math.min(index, pages.length - 1)].id : page.id;
    setActiveId(nextActiveId);
    setSelectedId(null);
    requestAnimationFrame(() =>
      document
        .querySelector<HTMLButtonElement>(
          `button[data-page-id="${nextActiveId}"]`,
        )
        ?.focus({ preventScroll: true }),
    );
    notify(`${index + 1}ページ目を削除しました。「元に戻す」で戻せます。`);
  };
  const showPageMenu = (
    pageId: string,
    x: number,
    y: number,
    anchor: HTMLElement,
  ) => {
    if (busy) return;
    activatePage(pageId);
    setPageMenu({ pageId, x, y, anchor });
  };
  const endPageDrag = () => {
    draggedPage.current = null;
    setDraggedPageId(null);
    setPageDrop(null);
  };
  const movePageByDrop = (
    sourceId: string,
    targetId: string,
    after: boolean,
  ) => {
    endPageDrag();
    if (busy || signedInput) return;
    const current = flushInlineText();
    const from = current.pages.findIndex((p) => p.id === sourceId);
    const target = current.pages.findIndex((p) => p.id === targetId);
    if (from < 0 || target < 0 || from === target) return;
    const insertion = target + (after ? 1 : 0);
    const to = insertion - (from < insertion ? 1 : 0);
    if (from === to) return;
    const pages = [...current.pages];
    const [moving] = pages.splice(from, 1);
    pages.splice(to, 0, moving);
    commit({ ...current, pages });
    setActiveId(sourceId);
    setSelectedId(null);
    setTool("select");
    requestAnimationFrame(() =>
      document
        .querySelector<HTMLButtonElement>(`button[data-page-id="${sourceId}"]`)
        ?.focus({ preventScroll: true }),
    );
    notify(
      `${from + 1}ページ目を${to + 1}ページ目へ移動しました。「元に戻す」で戻せます。`,
    );
  };

  const openBytes = useCallback(async (bytes: Uint8Array, name: string) => {
    while (
      currentRef.current.busy ||
      currentRef.current.signatureOpen ||
      currentRef.current.mergeOpen ||
      currentRef.current.projectOpen ||
      currentRef.current.aiSettingsOpen ||
      currentRef.current.certificateGuideOpen
    )
      await new Promise((resolve) => setTimeout(resolve, 100));
    if (
      currentRef.current.dirty &&
      !confirm(
        "保存していない変更があります。変更を破棄して別のPDFを開きますか？",
      )
    )
      return;
    if (bytes.length > 50 * 1024 * 1024) {
      setError(
        "MVPでは50MBまでのPDFを開けます。ファイルを分割してお試しください。",
      );
      return;
    }
    flushBeforeOperation.current();
    setBusy("PDFを開いています");
    setError("");
    try {
      const loaded = await loadPdf(bytes);
      const previous = currentRef.current.pdf;
      original.current = bytes;
      const initial = {
        pages: loaded.pages.map((p, i) => ({
          ...p,
          sourceName: name,
          sourcePage: i + 1,
        })),
        annotations: [],
      };
      setPdf(loaded.document);
      setSignedInput(loaded.signed ?? false);
      setEdits(initial);
      history.current = [initial];
      cursor.current = 0;
      setSavedState(JSON.stringify(initial));
      setActiveId(loaded.pages[0].id);
      setSelectedId(null);
      setTool("select");
      setFilename(name);
      setAiResult(null);
      setAiOpen(false);
      setPageMenu(null);
      setMessage(
        loaded.signed
          ? "署名情報のあるPDFを閲覧しています。有効性は未検証です。Acrobatなどで確認してください。編集には署名前の原本を使用してください。"
          : "道具を選んで、用紙の記入したい場所をクリックしてください。",
      );
      if (previous) void previous.loadingTask.destroy();
    } catch (e) {
      setError(e instanceof Error ? e.message : "PDFを開けませんでした。");
    } finally {
      setBusy("");
    }
  }, []);
  useEffect(
    () =>
      window.lumaDesktop?.onOpenPdf((file) =>
        openBytes(new Uint8Array(file.data), file.name),
      ),
    [openBytes],
  );
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (currentRef.current.dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, []);
  const openFile = async () => {
    try {
      if (window.lumaDesktop) {
        const file = await window.lumaDesktop.openPdf();
        if (file) await openBytes(new Uint8Array(file.data), file.name);
      } else pdfInput.current?.click();
    } catch {
      setError("ファイルを開けませんでした。もう一度お試しください。");
    }
  };
  const readFile = async (file: File) => {
    if (!file.name.toLowerCase().endsWith(".pdf")) {
      setError("PDFファイルを選んでください。");
      return;
    }
    await openBytes(new Uint8Array(await file.arrayBuffer()), file.name);
  };
  const queueMergeFiles = (incoming: { name: string; bytes: Uint8Array }[]) => {
    if (!incoming.length) return;
    const next = [
      ...mergeFiles,
      ...incoming.map((file) => ({ ...file, id: crypto.randomUUID() })),
    ];
    if (next.length > 30)
      throw new Error("一度に結合できるPDFは30個までです。");
    if (next.some((file) => !file.name.toLowerCase().endsWith(".pdf")))
      throw new Error("結合するファイルはPDFだけを選んでください。");
    if (
      next.reduce(
        (total, file) => total + file.bytes.byteLength,
        original.current?.byteLength ?? 0,
      ) >
      50 * 1024 * 1024
    )
      throw new Error("開いているPDFと追加するPDFの合計は50MBまでです。");
    setMergeFiles(next);
    setMergeError("");
    setMergeOpen(true);
  };
  const readMergeFiles = async (files: File[]) => {
    if (busy || signedInput || !files.length) return;
    flushInlineText();
    setMergeOpen(true);
    setMergeError("");
    setBusy("結合するPDFを読み込んでいます");
    try {
      if (files.length + mergeFiles.length > 30)
        throw new Error("一度に結合できるPDFは30個までです。");
      if (files.reduce((sum, f) => sum + f.size, 0) > 50 * 1024 * 1024)
        throw new Error("PDFは合計50MBまで選択できます。");
      const incoming = [];
      for (const file of files)
        incoming.push({
          name: file.name,
          bytes: new Uint8Array(await file.arrayBuffer()),
        });
      queueMergeFiles(incoming);
    } catch (e) {
      setMergeError(
        e instanceof Error ? e.message : "PDFを読み込めませんでした。",
      );
    } finally {
      setBusy("");
    }
  };
  const chooseMergeFiles = async () => {
    if (busy || signedInput) return;
    flushInlineText();
    setMergeOpen(true);
    setMergeError("");
    closePageMenu();
    if (!window.lumaDesktop) {
      mergeInput.current?.click();
      return;
    }
    setBusy("結合するPDFを選択しています");
    try {
      const files = await window.lumaDesktop.openPdfs();
      queueMergeFiles(
        files.map((file) => ({
          name: file.name,
          bytes: new Uint8Array(file.data),
        })),
      );
    } catch (e) {
      setMergeError(
        e instanceof Error ? e.message : "PDFを選択できませんでした。",
      );
    } finally {
      setBusy("");
    }
  };
  const mergeDocuments = async () => {
    if (busy || signedInput || !mergeFiles.length) return;
    const current = flushInlineText();
    setBusy("PDFを結合しています");
    setMergeError("");
    try {
      const result = await appendPdfSources(original.current, mergeFiles);
      const loaded = await loadPdf(result.bytes);
      const additions = loaded.pages
        .slice(result.originalPageCount)
        .map((p, i) => ({ ...p, ...result.addedPages[i] }));
      const next: EditState = {
        pages: [...current.pages, ...additions],
        annotations: current.annotations,
      };
      const previous = pdf;
      original.current = result.bytes;
      setPdf(loaded.document);
      setSignedInput(false);
      if (previous) recordEdit(next);
      else {
        history.current = [next];
        cursor.current = 0;
        setEdits(next);
        setSavedState("");
      }
      if (!previous) setFilename("結合した書類.pdf");
      else if (!filename.includes("_結合"))
        setFilename(filename.replace(/\.pdf$/i, "") + "_結合.pdf");
      setActiveId(additions[0].id);
      setSelectedId(null);
      setTool("select");
      setShowPages(true);
      setMergeOpen(false);
      setMergeFiles([]);
      setAiResult(null);
      closePageMenu();
      notify(
        `${mergeFiles.length}個のPDFを追加し、合計${next.pages.length}ページになりました。「PDFを保存」で書き出せます。`,
      );
      if (previous) void previous.loadingTask.destroy();
    } catch (e) {
      setMergeError(
        e instanceof Error ? e.message : "PDFを結合できませんでした。",
      );
    } finally {
      setBusy("");
    }
  };
  const sample = async () => {
    try {
      await openBytes(await createSamplePdf(), "サンプル_振込先届出書.pdf");
    } catch (e) {
      setError(String(e));
    }
  };

  const prepareTextGeometry = async (current: EditState): Promise<EditState> => {
    const annotations = await Promise.all(current.annotations.map((annotation) => {
      const sheet = current.pages.find((page) => page.id === annotation.pageId);
      return sheet ? resolveTextGeometry(annotation, sheet.height) : annotation;
    }));
    if (annotations.every((annotation, index) => annotation === current.annotations[index])) return current;
    const prepared = { ...current, annotations };
    // Geometry correction belongs to the text edit, not a new Undo step.
    history.current[cursor.current] = prepared;
    editsRef.current = prepared;
    setEdits(prepared);
    return prepared;
  };
  const save = async () => {
    if (!original.current || busy || signedInput) return;
    const current = flushInlineText();
    currentRef.current.busy = "PDFを書き出しています";
    setBusy("PDFを書き出しています");
    setError("");
    try {
      const prepared = await prepareTextGeometry(current);
      const data = await exportPdf(
        original.current,
        prepared.pages,
        prepared.annotations,
      );
      const name = filename.replace(/\.pdf$/i, "") + "_記入済.pdf";
      if (window.lumaDesktop) {
        if (!(await window.lumaDesktop.savePdf(Array.from(data), name))) return;
      } else {
        const blob = new Blob([new Uint8Array(data)], {
          type: "application/pdf",
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = name;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 30000);
      }
      setSavedState(JSON.stringify(prepared));
      notify("記入済みPDFを書き出しました。メールに添付して返送できます。");
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存できませんでした。");
    } finally {
      currentRef.current.busy = "";
      setBusy("");
    }
  };
  const saveProject = async () => {
    if (!original.current || busy || signedInput) return;
    const current = flushInlineText();
    currentRef.current.busy = "作業データを保存しています";
    setBusy("作業データを保存しています");
    setProjectError("");
    try {
      const prepared = await prepareTextGeometry(current);
      const bytes = encodeProject({
        filename,
        original: original.current,
        pages: prepared.pages,
        annotations: prepared.annotations,
      });
      const name = filename.replace(/\.pdf$/i, "") + ".lumapdf";
      if (window.lumaDesktop) {
        if (!(await window.lumaDesktop.saveProject(Array.from(bytes), name)))
          return;
      } else {
        const url = URL.createObjectURL(
          new Blob([new Uint8Array(bytes)], { type: "application/json" }),
        );
        const a = document.createElement("a");
        a.href = url;
        a.download = name;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 30000);
      }
      setSavedState(JSON.stringify(prepared));
      setProjectOpen(false);
      notify("編集を再開できる作業データを保存しました。");
    } catch (e) {
      setProjectError(
        e instanceof Error ? e.message : "作業データを保存できませんでした。",
      );
    } finally {
      currentRef.current.busy = "";
      setBusy("");
    }
  };
  const restoreProject = async (bytes: Uint8Array) => {
    if (busy) return;
    if (
      dirty &&
      !confirm(
        "保存していない変更があります。変更を破棄して作業データを開きますか？",
      )
    )
      return;
    flushNumericControls();
    setBusy("作業データを開いています");
    setProjectError("");
    let candidate: Awaited<ReturnType<typeof loadPdf>> | null = null;
    let adopted = false;
    try {
      const data = decodeProject(bytes);
      candidate = await loadPdf(data.original);
      if (candidate.signed)
        throw new Error(
          "署名付きPDFを含む作業データは編集できません。署名前の作業データを開いてください。",
        );
      const ids = new Map<string, string>();
      const pages = data.pages.map((p) => {
        const actual = candidate!.pages[p.sourceIndex];
        if (
          !actual ||
          Math.abs(actual.width - p.width) > 0.01 ||
          Math.abs(actual.height - p.height) > 0.01
        )
          throw new Error("作業データのページ情報が元のPDFと一致しません。");
        const id = crypto.randomUUID();
        ids.set(p.id, id);
        return {
          ...actual,
          id,
          rotation: p.rotation,
          sourceName: p.sourceName,
          sourcePage: p.sourcePage,
        };
      });
      const annotations = data.annotations.map((a) => ({
        ...a,
        id: crypto.randomUUID(),
        pageId: ids.get(a.pageId)!,
      }));
      const next = { pages, annotations };
      const previous = pdf;
      original.current = data.original;
      setPdf(candidate.document);
      adopted = true;
      setSignedInput(false);
      setEdits(next);
      history.current = [next];
      cursor.current = 0;
      setSavedState(JSON.stringify(next));
      setFilename(data.filename);
      setActiveId(pages[0].id);
      setSelectedId(null);
      setTool("select");
      setAiResult(null);
      setAiOpen(false);
      setProjectOpen(false);
      closePageMenu();
      notify("作業データを開きました。文字・印鑑を選んで編集を続けられます。");
      if (previous) void previous.loadingTask.destroy();
    } catch (e) {
      const message =
        e instanceof Error ? e.message : "作業データを開けませんでした。";
      setProjectError(message);
      setError(message);
    } finally {
      // Releasing an invalid candidate can wait on a stalled PDF worker.
      // Keep the original document usable and show the validation error now.
      if (candidate && !adopted) void candidate.document.loadingTask.destroy().catch(() => {});
      setBusy("");
    }
  };
  const openProject = async () => {
    if (busy) return;
    setProjectError("");
    if (!window.lumaDesktop) {
      projectInput.current?.click();
      return;
    }
    try {
      const file = await window.lumaDesktop.openProject();
      if (file) await restoreProject(new Uint8Array(file.data));
    } catch {
      setProjectError("作業データを選択できませんでした。");
    }
  };
  const signAndSave = async (options: {
    password: string;
    reason: string;
    location: string;
  }) => {
    if (!original.current || !window.lumaDesktop || busy || signedInput) return;
    const current = flushInlineText();
    setBusy("証明書で署名して保存しています");
    setError("");
    try {
      const bytes = await exportPdf(
        original.current,
        current.pages,
        current.annotations,
      );
      const saved = await window.lumaDesktop.signAndSavePdf(
        Array.from(bytes),
        filename.replace(/\.pdf$/i, "") + "_署名済.pdf",
        options,
      );
      if (!saved) throw new Error("保存をキャンセルしました。");
      setSavedState(JSON.stringify(current));
      setSignatureOpen(false);
      notify(
        "電子署名済みPDFを保存しました。開いている画面は署名前の作業用原稿です。",
      );
    } finally {
      setBusy("");
    }
  };
  const exportOnePage = async (id: string) => {
    closePageMenu();
    if (!original.current || busy || signedInput) return;
    const current = flushInlineText();
    const index = current.pages.findIndex((p) => p.id === id);
    if (index < 0) return;
    setBusy("選んだページを書き出しています");
    setError("");
    try {
      const bytes = await exportPdf(
        original.current,
        [current.pages[index]],
        current.annotations.filter((a) => a.pageId === id),
      );
      const name = filename.replace(/\.pdf$/i, "") + `_${index + 1}ページ.pdf`;
      if (window.lumaDesktop) {
        if (!(await window.lumaDesktop.savePdf(Array.from(bytes), name)))
          return;
      } else {
        const url = URL.createObjectURL(
          new Blob([new Uint8Array(bytes)], { type: "application/pdf" }),
        );
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = name;
        anchor.click();
        setTimeout(() => URL.revokeObjectURL(url), 30000);
      }
      notify(
        `${index + 1}ページ目だけをPDFに保存しました。編集中の書類はそのままです。`,
      );
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "ページを保存できませんでした。",
      );
    } finally {
      setBusy("");
    }
  };
  const print = async () => {
    if (!original.current || busy) return;
    const current = flushInlineText();
    setBusy("印刷を準備しています");
    setError("");
    try {
      const data = signedInput
        ? original.current
        : await exportPdf(original.current, current.pages, current.annotations);
      if (window.lumaDesktop)
        await window.lumaDesktop.printPdf(Array.from(data));
      else {
        const exported = await loadPdf(data);
        const printArea = document.getElementById("print-area")!;
        printArea.replaceChildren();
        try {
          for (const p of exported.pages) {
            const canvas = document.createElement("canvas");
            await renderPdfPage(exported.document, p.sourceIndex, canvas, 1.6);
            const img = new Image();
            img.src = canvas.toDataURL("image/png");
            img.className = "print-page";
            await img.decode();
            printArea.appendChild(img);
          }
          window.print();
        } finally {
          await exported.document.loadingTask.destroy();
        }
      }
      notify(
        "印刷画面を開きました。プリンターと用紙サイズを確認してください。",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "印刷できませんでした。");
    } finally {
      setBusy("");
    }
  };
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.isComposing || e.keyCode === 229 || e.defaultPrevented) return;
      if (
        profileOpen ||
        printHelp ||
        aiOpen ||
        stampFile ||
        signatureOpen ||
        mergeOpen ||
        projectOpen ||
        pageMenu ||
        aiSettingsOpen ||
        certificateGuideOpen
      )
        return;
      const typing =
        e.target instanceof HTMLElement &&
        !!e.target.closest(
          "input, textarea, select, [contenteditable], .inline-text-editor",
        );
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void save();
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "p") {
        e.preventDefault();
        void print();
      } else if (
        !typing &&
        !busy &&
        !signedInput &&
        selected &&
        page &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey &&
        ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key) &&
        (!(e.target instanceof HTMLElement) ||
          !e.target.closest("button, [role=button]:not(.annotation)"))
      ) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        // Keys follow the visible page even when the original coordinates are rotated.
        const dx =
          e.key === "ArrowRight" ? step : e.key === "ArrowLeft" ? -step : 0;
        const dy =
          e.key === "ArrowDown" ? step : e.key === "ArrowUp" ? -step : 0;
        const radians = (page.rotation * Math.PI) / 180;
        updateSelected({
          x:
            selected.x +
            Math.round(dx * Math.cos(radians) + dy * Math.sin(radians)),
          y:
            selected.y +
            Math.round(-dx * Math.sin(radians) + dy * Math.cos(radians)),
        });
      } else if (
        !typing &&
        !busy &&
        (e.metaKey || e.ctrlKey) &&
        e.key.toLowerCase() === "z"
      ) {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (
        !typing &&
        !busy &&
        (e.key === "Delete" || e.key === "Backspace")
      ) {
        e.preventDefault();
        removeSelected();
      } else if (!typing && e.key === "Escape") {
        setSelectedId(null);
        setTool("select");
        setProfileOpen(false);
        setPrintHelp(false);
        if (!busy) setAiOpen(false);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  });

  const place = async (x: number, y: number) => {
    if (
      !page ||
      tool === "select" ||
      tool === "hand" ||
      currentRef.current.busy ||
      signedInput
    )
      return;
    flushNumericControls();
    const { fontSize, stampSize, strokeWidth } = placementSettings.current;
    if (tool === "stamp" && !stamp.name.trim() && !stamp.dataUrl) {
      setError("印鑑に入れる名前を入力してください。");
      return;
    }
    if (tool === "image" && !imageData) {
      imageInput.current?.click();
      return;
    }
    let width =
      tool === "text" && !text.trim()
        ? Math.min(240, page.width)
        : tool === "text"
          ? Math.min(
              260,
              Math.max(
                80,
                text
                  .split("\n")
                  .reduce((n, line) => Math.max(n, line.length), 0) *
                  fontSize +
                  8,
              ),
            )
          : tool === "image"
            ? imageData!.width
            : tool === "check"
              ? 12
              : tool === "shape"
                ? shapeKind === "rectangle"
                  ? 120
                  : 100
                : stampSize;
    let height =
      tool === "text"
        ? Math.max(25, text.split("\n").length * fontSize * 1.45 + 6)
        : tool === "image"
          ? imageData!.height
          : tool === "check"
            ? 12
            : tool === "shape"
              ? shapeKind === "ellipse"
                ? 100
                : shapeKind === "triangle"
                  ? 90
                  : 80
              : stampSize;
    if (tool === "stamp" && stamp.dataUrl && stamp.aspectRatio) {
      if (stamp.aspectRatio < 1) width *= stamp.aspectRatio;
      else height /= stamp.aspectRatio;
    }
    if (tool === "stamp") {
      const fit = Math.min(1, page.width / width, page.height / height);
      width *= fit;
      height *= fit;
    } else {
      width = Math.min(page.width, width);
      height = Math.min(page.height, height);
    }
    const annotation: Annotation = {
      id: crypto.randomUUID(),
      pageId: page.id,
      type: tool === "stamp" && stamp.dataUrl ? "image" : tool,
      x: Math.max(0, Math.min(page.width - width, x)),
      y: Math.max(0, Math.min(page.height - height, y)),
      width,
      height,
      text: tool === "stamp" ? stamp.name : tool === "text" ? text : undefined,
      fontSize,
      ...(tool === "text"
        ? { fontFamily, fontWeight, fontStyle, underline }
        : {}),
      ...(tool === "shape"
        ? { shapeKind, strokeColor, fillColor, strokeWidth }
        : {}),
      color: tool === "stamp" ? "#bb373c" : color,
      stampShape: stamp.shape,
      ...(tool === "stamp" && stamp.dataUrl ? { stampSource: true as const } : {}),
      dataUrl:
        tool === "stamp"
          ? stamp.dataUrl
          : tool === "image"
            ? imageData?.dataUrl
            : undefined,
    };
    const finish = () => {
      if (annotation.type === "text") {
        annotation.height = Math.min(
          page.height,
          measureTextHeight(annotation),
        );
        annotation.y = Math.max(
          0,
          Math.min(page.height - annotation.height, y),
        );
      }
      if (tool === "text" && !text.trim()) setTextDraft(annotation);
      else
        recordEdit({
          ...editsRef.current,
          annotations: [...editsRef.current.annotations, annotation],
        });
      setSelectedId(annotation.id);
      setTool("select");
      setError("");
    };
    if (annotation.type === "text" && !isTextFontReady(annotation)) {
      currentRef.current.busy = "フォントを読み込んでいます";
      setBusy(currentRef.current.busy);
      try {
        await ensureTextFont(annotation);
        finish();
      } catch (error) {
        setError(String(error));
      } finally {
        currentRef.current.busy = "";
        setBusy("");
      }
    } else finish();
  };
  const chooseTool = (value: Tool) => {
    flushInlineText();
    setTool(value);
    setSelectedId(null);
    if (value === "image" && !imageData) imageInput.current?.click();
  };
  const importImage = async (file: File, isStamp: boolean) => {
    if (
      !["image/png", "image/jpeg"].includes(file.type) ||
      file.size > 2 * 1024 * 1024
    ) {
      setError("2MB以下のPNGまたはJPEG画像を選んでください。");
      return;
    }
    if (isStamp) {
      setStampFile(file);
      return;
    }
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const img = new Image();
      img.src = dataUrl;
      await img.decode();
      if (isStamp) {
        setStamp({ ...stamp, dataUrl });
        setTool("stamp");
        setSelectedId(null);
      } else {
        const factor = Math.min(1, 160 / Math.max(img.width, img.height));
        setImageData({
          dataUrl,
          width: img.width * factor,
          height: img.height * factor,
        });
        setTool("image");
        setSelectedId(null);
      }
    } catch {
      setError("画像を読み込めませんでした。別の画像をお試しください。");
    }
  };
  const fit = (wholePage = false) => {
    if (!page || !workspaceRef.current) return;
    const widthScale =
      (workspaceRef.current.clientWidth - 90) /
      (page.rotation % 180 ? page.height : page.width);
    const heightScale =
      (workspaceRef.current.clientHeight - 120) /
      (page.rotation % 180 ? page.width : page.height);
    viewport.zoomTo(wholePage ? Math.min(widthScale, heightScale) : widthScale);
  };
  const renderError = useCallback((value: string) => setError(value), []);
  const registerStamp = (value: SavedStamp) => {
    try {
      if (!value.name.trim()) {
        setError("印鑑の名前を入力してください。");
        return false;
      }
      const saved = { ...value, id: value.id ?? crypto.randomUUID() };
      const library = [
        ...stampLibrary.filter((item) => item.id !== saved.id),
        saved,
      ];
      if (library.length > 12) {
        setError(
          "印鑑は12個まで登録できます。使わない印鑑を削除してください。",
        );
        return false;
      }
      localStorage.setItem("luma.stamps.v1", JSON.stringify(library));
      localStorage.setItem("luma.stamp.v1", JSON.stringify(saved));
      setStampLibrary(library);
      setStamp(saved);
      notify("印鑑をこの端末に登録しました。");
      return true;
    } catch {
      setError(
        "印鑑を保存できませんでした。画像のサイズを小さくしてください。",
      );
      return false;
    }
  };
  const saveStamp = () => registerStamp(stamp);

  const runAi = async () => {
    if (!pdf || !page || busy) return;
    const current = flushInlineText();
    setBusy("AIが記入欄を読み取っています");
    setError("");
    setAiResult(null);
    try {
      const canvas = document.createElement("canvas");
      await renderPdfPage(pdf, page.sourceIndex, canvas, 1.8);
      const context = canvas.getContext("2d")!;
      for (const annotation of current.annotations.filter(
        (a) => a.pageId === page.id,
      )) {
        const img = new Image();
        img.src = await annotationToDataUrl(annotation);
        await img.decode();
        context.drawImage(
          img,
          (annotation.x * canvas.width) / page.width,
          (annotation.y * canvas.height) / page.height,
          (annotation.width * canvas.width) / page.width,
          (annotation.height * canvas.height) / page.height,
        );
      }
      const request = {
        pages: [
          prepareAiPage(canvas, {
            pageId: page.id,
            width: page.width,
            height: page.height,
          }),
        ],
        profile: { ...profile, 記入日: entryDate },
        stamp: {
          enabled: includeStamp && !!(stamp.name || stamp.dataUrl),
          name: stamp.name || "登録印鑑",
        },
      };
      let result: AiResult;
      if (window.lumaDesktop)
        result = await window.lumaDesktop.autofill(request);
      else {
        const response = await fetch("/api/autofill", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(request),
        });
        const data = await response.json();
        if (!response.ok)
          throw new Error(data.error || "AI処理に失敗しました。");
        result = data;
      }
      setAiResult(result);
      setAiSelection(result.placements.map((_, i) => i));
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "AIに接続できませんでした。デスクトップ版かAI対応の開発サーバーでお試しください。",
      );
    } finally {
      setBusy("");
    }
  };
  const applyAi = async () => {
    if (!aiResult || currentRef.current.busy) return;
    const current = flushInlineText();
    const additions: Annotation[] = aiResult.placements
      .filter((_, i) => aiSelection.includes(i))
      .map((p) => ({
        id: crypto.randomUUID(),
        pageId: p.pageId,
        type: p.type === "stamp" && stamp.dataUrl ? "image" : p.type,
        x: p.x,
        y: p.y,
        width:
          p.type === "stamp" && stamp.aspectRatio && stamp.aspectRatio < 1
            ? p.width * stamp.aspectRatio
            : p.width,
        height:
          p.type === "stamp" && stamp.aspectRatio && stamp.aspectRatio > 1
            ? p.height / stamp.aspectRatio
            : p.height,
        text: p.type === "stamp" ? stamp.name : p.text,
        fontSize: Math.max(
          6,
          Math.min(
            fontSize,
            Math.max(6, (p.height - 6) / 1.4),
            (p.width - 4) / Math.max(1, p.text.length),
          ),
        ),
        color: p.type === "stamp" ? "#bb373c" : "#000000",
        ...(p.type === "text"
          ? { fontFamily, fontWeight, fontStyle, underline }
          : {}),
        stampShape: stamp.shape,
        ...(p.type === "stamp" && stamp.dataUrl ? { stampSource: true as const } : {}),
        dataUrl: p.type === "stamp" ? stamp.dataUrl : undefined,
      }));
    currentRef.current.busy = "文字の書式を準備しています";
    setBusy(currentRef.current.busy);
    try {
      await Promise.all(
        additions.filter((a) => a.type === "text").map(ensureTextFont),
      );
      for (const a of additions) {
        const sheet = current.pages.find((p) => p.id === a.pageId);
        if (sheet && a.type === "text")
          a.height = Math.min(
            sheet.height - a.y,
            Math.max(a.height, measureTextHeight(a)),
          );
      }
      recordEdit({
        ...current,
        annotations: [...current.annotations, ...additions],
      });
      setAiOpen(false);
      setTool("select");
      setSelectedId(additions[0]?.id ?? null);
      notify(
        `${additions.length}件を配置しました。位置と内容を確認し、必要に応じて編集してください。`,
      );
    } catch (error) {
      setError(String(error));
    } finally {
      currentRef.current.busy = "";
      setBusy("");
    }
  };

  const toolItems: { id: Tool; label: string; icon: typeof Type }[] = [
    { id: "select", label: "選択・移動", icon: MousePointer2 },
    { id: "hand", label: "手のひら・スクロール", icon: Hand },
    { id: "text", label: "文字を記入", icon: Type },
    { id: "stamp", label: "印鑑", icon: Stamp },
    { id: "check", label: "チェック", icon: CheckCheck },
    { id: "image", label: "画像", icon: ImagePlus },
    { id: "shape", label: "図形", icon: Shapes },
  ];
  const stampPreview: Annotation = {
    id: "preview",
    pageId: "",
    type: stamp.dataUrl ? "image" : "stamp",
    x: 0,
    y: 0,
    width: 96,
    height: 96,
    text: stamp.name || "印",
    color: "#bb373c",
    stampShape: stamp.shape,
    dataUrl: stamp.dataUrl,
  };

  return (
    <>
      <div
        className="app-shell"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const files = Array.from(e.dataTransfer.files);
          if (files.length > 1) void readMergeFiles(files);
          else if (files[0]?.name.toLowerCase().endsWith(".lumapdf"))
            void files[0]
              .arrayBuffer()
              .then((bytes) => restoreProject(new Uint8Array(bytes)));
          else if (files[0]) void readFile(files[0]);
        }}
      >
        <header className="app-header">
          <div className="brand">
            <div className="brand-icon">
              <FileText size={23} />
            </div>
            <div>
              <span className="brand-name">
                LumaStudio <b>PDF</b>
              </span>
              <span className="brand-caption">
                書類の仕上げを、もっと手軽に。
              </span>
            </div>
            <span className="version">MVP</span>
          </div>
          <div className="header-actions">
            <button
              disabled={!!busy}
              aria-label="証明書ガイド"
              onClick={() => setCertificateGuideOpen(true)}
            >
              <ShieldCheck size={17} />
              <span>証明書ガイド</span>
            </button>
            <button
              disabled={!!busy}
              aria-label="AI設定"
              onClick={() => setAiSettingsOpen(true)}
            >
              <KeyRound size={17} />
              <span>AI設定</span>
            </button>
            <button
              disabled={!!busy}
              onClick={() => {
                setProjectOpen(true);
                setProjectError("");
              }}
            >
              <Save size={17} />
              <span>作業データ</span>
            </button>
            <button onClick={() => setProfileOpen(true)} disabled={!!busy}>
              <UserRound size={17} />
              <span>登録情報</span>
            </button>
            <button onClick={() => setPrintHelp(true)}>
              <Printer size={17} />
              <span>印刷から取り込む</span>
            </button>
          </div>
        </header>
        <div className="document-bar">
          <div className="document-name">
            <FileText size={17} />
            <span>{filename || "PDFを開いて、はじめましょう"}</span>
            {dirty && <span className="unsaved">未保存</span>}
            {signedInput && (
              <span className="signed-badge">署名付きPDF・未検証</span>
            )}
          </div>
          <div className="document-actions">
            <button onClick={openFile} disabled={!!busy}>
              <FolderOpen size={17} />
              開く
            </button>
            <button onClick={chooseMergeFiles} disabled={!!busy || signedInput}>
              <FilePlus2 size={17} />
              PDFを結合
            </button>
            <button onClick={print} disabled={!pdf || !!busy}>
              <Printer size={17} />
              印刷
            </button>
            <button
              className="primary"
              onClick={save}
              disabled={!pdf || !!busy || signedInput}
            >
              <Download size={17} />
              PDFを保存
            </button>
            <button
              className="secondary signature-button"
              title={
                window.lumaDesktop
                  ? "証明書で電子署名して別名保存"
                  : "電子署名はデスクトップ版で利用できます"
              }
              onClick={() => setSignatureOpen(true)}
              disabled={!pdf || !!busy || signedInput || !window.lumaDesktop}
            >
              <ShieldCheck size={17} />
              署名して保存
            </button>
          </div>
        </div>
        <div className="toolbar">
          <div className="tool-group">
            {toolItems.map((item) => (
              <button
                key={item.id}
                className={tool === item.id && !selected ? "active" : ""}
                onClick={() => chooseTool(item.id)}
                disabled={
                  !pdf ||
                  !!busy ||
                  (signedInput && item.id !== "hand" && item.id !== "select")
                }
              >
                <item.icon size={18} />
                <span>{item.label}</span>
              </button>
            ))}
          </div>
          <div className="toolbar-right">
            <button
              className="ai-button"
              onClick={() => {
                setAiOpen(true);
                setAiResult(null);
              }}
              disabled={!pdf || !!busy || signedInput}
            >
              <Sparkles size={17} />
              AI自動記入
            </button>
            <span className="toolbar-divider" />
            <button
              aria-label="元に戻す"
              title="元に戻す Ctrl / ⌘ Z"
              onClick={undo}
              disabled={!pdf || cursor.current === 0 || !!busy}
            >
              <Undo2 size={18} />
            </button>
            <button
              aria-label="やり直す"
              onClick={redo}
              disabled={
                !pdf || cursor.current >= history.current.length - 1 || !!busy
              }
            >
              <Redo2 size={18} />
            </button>
          </div>
        </div>
        <div className={`editor-layout ${!showPages ? "pages-hidden" : ""}`}>
          {showPages && (
            <aside className="pages-panel">
              <div className="panel-title">
                <h2>
                  ページ <span>{edits.pages.length || ""}</span>
                </h2>
                <button
                  className="icon-button"
                  aria-label="ページ一覧を閉じる"
                  onClick={() => setShowPages(false)}
                >
                  <PanelLeftClose size={16} />
                </button>
              </div>
              {pdf ? (
                <>
                  <p className="pages-help">
                    ドラッグで順番を変更
                    <br />
                    右クリックでページを削除
                  </p>
                  <div className="thumbnails">
                    {edits.pages.map((p, i) => (
                      <div
                        className={`thumbnail-entry ${draggedPageId === p.id ? "dragging" : ""} ${pageDrop?.pageId === p.id && draggedPageId !== p.id ? (pageDrop.after ? "drop-after" : "drop-before") : ""}`}
                        key={p.id}
                        data-page-entry={p.id}
                        onDragOver={(event) => {
                          if (!draggedPage.current || busy || signedInput)
                            return;
                          event.preventDefault();
                          event.stopPropagation();
                          event.dataTransfer.dropEffect = "move";
                          const r = event.currentTarget.getBoundingClientRect();
                          setPageDrop({
                            pageId: p.id,
                            after: event.clientY > r.top + r.height / 2,
                          });
                        }}
                        onDragLeave={(event) => {
                          if (
                            !(event.relatedTarget instanceof Node) ||
                            !event.currentTarget.contains(event.relatedTarget)
                          )
                            setPageDrop((current) =>
                              current?.pageId === p.id ? null : current,
                            );
                        }}
                        onDrop={(event) => {
                          const sourceId = event.dataTransfer.getData(
                            "application/x-luma-page",
                          );
                          if (!sourceId) return;
                          event.preventDefault();
                          event.stopPropagation();
                          const r = event.currentTarget.getBoundingClientRect();
                          movePageByDrop(
                            sourceId,
                            p.id,
                            event.clientY > r.top + r.height / 2,
                          );
                        }}
                      >
                        <button
                          className={`thumbnail-button ${p.id === page?.id ? "active" : ""}`}
                          aria-label={`${i + 1}ページ目`}
                          data-page-id={p.id}
                          draggable={!signedInput && !busy}
                          onDragStart={(event) => {
                            if (busy || signedInput) {
                              event.preventDefault();
                              return;
                            }
                            closePageMenu();
                            draggedPage.current = p.id;
                            setDraggedPageId(p.id);
                            event.dataTransfer.effectAllowed = "move";
                            event.dataTransfer.setData(
                              "application/x-luma-page",
                              p.id,
                            );
                          }}
                          onDragEnd={endPageDrag}
                          title={
                            p.sourceName
                              ? `${p.sourceName} (${p.sourcePage ?? p.sourceIndex + 1}ページ目)`
                              : undefined
                          }
                          onContextMenu={(event) => {
                            event.preventDefault();
                            showPageMenu(
                              p.id,
                              event.clientX,
                              event.clientY,
                              event.currentTarget,
                            );
                          }}
                          onKeyDown={(event) => {
                            if (
                              event.key === "ContextMenu" ||
                              (event.shiftKey && event.key === "F10")
                            ) {
                              event.preventDefault();
                              const r =
                                event.currentTarget.getBoundingClientRect();
                              showPageMenu(
                                p.id,
                                r.right,
                                r.top + 28,
                                event.currentTarget,
                              );
                            }
                          }}
                          onClick={() => {
                            closePageMenu();
                            activatePage(p.id);
                          }}
                        >
                          <div className="thumbnail-paper">
                            <Thumbnail document={pdf} page={p} />
                            {edits.annotations.some(
                              (a) => a.pageId === p.id,
                            ) && <span className="edited-dot" />}
                          </div>
                          <span>{i + 1}</span>
                        </button>
                        <button
                          className="thumbnail-options"
                          aria-label={`${i + 1}ページ目の操作`}
                          aria-haspopup="menu"
                          disabled={!!busy}
                          onClick={(event) => {
                            const r =
                              event.currentTarget.getBoundingClientRect();
                            showPageMenu(
                              p.id,
                              r.right,
                              r.bottom,
                              event.currentTarget,
                            );
                          }}
                        >
                          <MoreHorizontal size={17} />
                        </button>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <div className="empty-pages">
                  <FileText size={28} />
                  <p>
                    開いたPDFのページが
                    <br />
                    ここに並びます
                  </p>
                </div>
              )}
              <div className="local-note">
                <ShieldCheck size={15} />
                <span>基本の編集は端末内で完結</span>
              </div>
            </aside>
          )}
          <main
            className={`workspace ${viewport.panning || tool === "hand" ? "panning" : ""}`}
            ref={workspaceRef}
            {...viewport.viewportHandlers}
          >
            {!pdf ? (
              <div className="welcome">
                <div className="welcome-paper">
                  <div className="paper-label">いつもの書類を、ここで。</div>
                  <div className="paper-line long" />
                  <div className="paper-line" />
                  <div className="paper-field">
                    <span>お名前</span>
                    <span className="handwriting">山田 太郎</span>
                  </div>
                  <div className="paper-field">
                    <span>日付</span>
                    <span className="handwriting">2026年9月22日</span>
                  </div>
                  <div className="illustration-seal">
                    山<br />田
                  </div>
                  <div className="paper-footnote">
                    記入して、押して、できあがり。
                  </div>
                </div>
                <h1>
                  届いたPDFを、
                  <br />
                  返せる書類に。
                </h1>
                <p>
                  口座の届出、請求書、契約書。
                  <br />
                  文字も印鑑も、好きな場所に置くだけ。
                </p>
                <button className="primary open-large" onClick={openFile}>
                  <FolderOpen size={20} />
                  PDFを開く
                </button>
                <span className="drop-hint">または、ここにPDFをドラッグ</span>
                <button className="sample-button" onClick={sample}>
                  <FilePlus2 size={16} />
                  サンプルの書類で試す
                </button>
              </div>
            ) : (
              <div className="paper-desk">
                <div className="page-caption">
                  <span>
                    {pageIndex + 1} / {edits.pages.length} ページ
                  </span>
                  <span>
                    {tool === "hand"
                      ? "ドラッグで移動・2本指で拡大縮小"
                      : tool === "select"
                        ? "文字はダブルクリックで編集・四隅をドラッグでサイズ変更"
                        : tool === "text" && !text.trim()
                          ? "記入欄をクリックして、その場で入力"
                          : "用紙の置きたい場所をクリック"}
                  </span>
                </div>
                <PdfPage
                  key={page.id}
                  ref={pageEditorRef}
                  document={pdf}
                  page={page}
                  scale={scale}
                  annotations={edits.annotations
                    .map((a) =>
                      numericPreview?.id === a.id ? numericPreview : a,
                    )
                    .filter((a) => a.pageId === page.id)}
                  selectedId={selectedId}
                  placing={tool !== "select" && tool !== "hand"}
                  readOnly={signedInput || !!busy}
                  panning={viewport.panning || tool === "hand"}
                  isGesturePointer={viewport.isGesturePointer}
                  textDraft={textDraft}
                  onTextDraftConsumed={() => setTextDraft(null)}
                  onTextEditingChange={setTextEditing}
                  onCommitText={applyText}
                  onResize={(id, patch) => {
                    const source = editsRef.current.annotations.find((a) => a.id === id);
                    commit({
                      ...editsRef.current,
                      annotations: editsRef.current.annotations.map((a) =>
                        a.id === id ? { ...a, ...patch } : a,
                      ),
                    });
                    if (source && isSeal(source))
                      rememberStampSize(Math.max(patch.width ?? source.width, patch.height ?? source.height));
                  }}
                  onPlace={place}
                  onSelect={(id) => {
                    flushInlineText();
                    setSelectedId(id);
                    setTool("select");
                  }}
                  onMove={(id, x, y) =>
                    commit({
                      ...editsRef.current,
                      annotations: editsRef.current.annotations.map((a) =>
                        a.id === id ? { ...a, x, y } : a,
                      ),
                    })
                  }
                  onError={renderError}
                />
                <div className="page-below">
                  元のPDFに、文字や印影を重ねて保存します。
                </div>
              </div>
            )}
          </main>
          <aside className="properties-panel">
            <div className="panel-title">
              <h2>
                {selected
                  ? "選択した要素を編集"
                  : tool === "stamp"
                    ? "印鑑を用意"
                    : tool === "text"
                      ? "文字を記入"
                      : tool === "image"
                        ? "画像を追加"
                        : tool === "shape"
                          ? "図形を追加"
                          : tool === "check"
                            ? "チェックを追加"
                            : "書類を仕上げる"}
              </h2>
              {selected && (
                <button
                  className="icon-button"
                  aria-label="選択を解除"
                  onClick={() => {
                    flushInlineText();
                    setSelectedId(null);
                  }}
                >
                  <X size={16} />
                </button>
              )}
            </div>
            <div className="properties-content">
              {selected ? (
                <>
                  <span className="field-eyebrow">
                    {selected.type === "text"
                      ? "文字"
                      : selected.type === "stamp"
                        ? "印鑑"
                        : selected.type === "image"
                          ? "画像・印影"
                          : selected.type === "shape"
                            ? "図形"
                            : "チェック"}
                  </span>
                  {(selected.type === "text" || selected.type === "stamp") && (
                    <label>
                      内容
                      <textarea
                        value={selected.text ?? ""}
                        maxLength={selected.type === "stamp" ? 8 : 3000}
                        onChange={(e) =>
                          updateSelected({ text: e.target.value })
                        }
                        rows={selected.type === "stamp" ? 2 : 4}
                      />
                    </label>
                  )}
                  {selected.type === "text" && (
                    <TextStyleFields
                      value={selected}
                      onChange={updateSelected}
                      disabled={!!busy || signedInput}
                    />
                  )}
                  {selected.type === "shape" && (
                    <ShapeStyleFields
                      key={selected.id}
                      value={selected}
                      onChange={updateSelected}
                      onWidthPreview={(value) =>
                        previewSelected("strokeWidth", value)
                      }
                      onScrubStart={flushInlineText}
                      onEditingChange={setNumericEditing}
                      disabled={!!busy || signedInput}
                    />
                  )}
                  {selected.type === "text" && (
                    <label>
                      文字サイズ
                      <NumericField
                        key={`${selected.id}-fontSize`}
                        aria-label="文字サイズ"
                        min={6}
                        max={96}
                        step={1}
                        suffix="pt"
                        value={selected.fontSize ?? 16}
                        disabled={
                          !!busy || signedInput || !isTextFontReady(selected)
                        }
                        onChange={(fontSize) => updateSelected({ fontSize })}
                        onPreview={(value) =>
                          previewSelected("fontSize", value)
                        }
                        onScrubStart={flushInlineText}
                        onEditingChange={setNumericEditing}
                      />
                    </label>
                  )}
                  <div className="two-fields">
                    <label>
                      幅
                      <NumericField
                        key={`${selected.id}-width`}
                        aria-label="要素の幅"
                        min={8}
                        max={page?.width}
                        value={selected.width}
                        suffix="pt"
                        disabled={
                          !!busy ||
                          signedInput ||
                          (selected.type === "text" &&
                            !isTextFontReady(selected))
                        }
                        onChange={(width) => updateSelected({ width })}
                        onPreview={(value) => previewSelected("width", value)}
                        onScrubStart={flushInlineText}
                        onEditingChange={setNumericEditing}
                      />
                    </label>
                    <label>
                      高さ
                      <NumericField
                        key={`${selected.id}-height`}
                        aria-label="要素の高さ"
                        min={8}
                        max={page?.height}
                        value={selected.height}
                        suffix="pt"
                        disabled={
                          !!busy ||
                          signedInput ||
                          (selected.type === "text" &&
                            !isTextFontReady(selected))
                        }
                        onChange={(height) => updateSelected({ height })}
                        onPreview={(value) => previewSelected("height", value)}
                        onScrubStart={flushInlineText}
                        onEditingChange={setNumericEditing}
                      />
                    </label>
                  </div>
                  {selected.type !== "image" && selected.type !== "shape" && (
                    <label className="color-field">
                      色
                      <input
                        type="color"
                        value={selected.color ?? color}
                        onChange={(e) =>
                          updateSelected({ color: e.target.value })
                        }
                      />
                    </label>
                  )}
                  <p className="help-text">
                    {selected.type === "shape"
                      ? "辺や角をドラッグすると、縦横を自由に変えられます。"
                      : "四隅をドラッグしてサイズ変更。文字はダブルクリックで直接編集できます。"}
                    数値欄は直接入力・横ドラッグで調整。矢印キーで素材の位置を微調整できます。
                  </p>
                  <button
                    className="secondary full"
                    onClick={() => {
                      const a = {
                        ...selected,
                        id: crypto.randomUUID(),
                        x: Math.min(
                          page.width - selected.width,
                          selected.x + 12,
                        ),
                        y: Math.min(
                          page.height - selected.height,
                          selected.y + 12,
                        ),
                      };
                      commit({
                        ...edits,
                        annotations: [...edits.annotations, a],
                      });
                      setSelectedId(a.id);
                    }}
                  >
                    <Plus size={16} />
                    複製する
                  </button>
                  <button
                    className="text-button danger full"
                    onClick={removeSelected}
                  >
                    <Trash2 size={16} />
                    この要素を削除
                  </button>
                </>
              ) : tool === "shape" ? (
                <>
                  <ShapeStyleFields
                    value={{ shapeKind, strokeColor, fillColor, strokeWidth }}
                    disabled={!!busy || signedInput}
                    onChange={(change) => {
                      if (change.shapeKind) setShapeKind(change.shapeKind);
                      if (change.strokeColor !== undefined)
                        setStrokeColor(change.strokeColor);
                      if (change.fillColor !== undefined)
                        setFillColor(change.fillColor);
                      if (change.strokeWidth !== undefined) {
                        placementSettings.current.strokeWidth =
                          change.strokeWidth;
                        setStrokeWidth(change.strokeWidth);
                      }
                    }}
                  />
                  <div className="shape-preview" aria-label="図形のプレビュー">
                    <AnnotationVisual
                      annotation={{
                        id: "shape-preview",
                        pageId: "",
                        type: "shape",
                        shapeKind,
                        strokeColor,
                        fillColor,
                        strokeWidth,
                        x: 0,
                        y: 0,
                        width: 150,
                        height: 100,
                      }}
                    />
                  </div>
                  <p className="help-text">
                    用紙をクリックして配置します。選択した図形の辺・角をドラッグすると、長方形や楕円など自由な縦横比に変えられます。
                  </p>
                </>
              ) : tool === "text" ? (
                <>
                  <label>
                    記入する文字
                    <textarea
                      autoFocus
                      value={text}
                      maxLength={3000}
                      onChange={(e) => setText(e.target.value)}
                      rows={4}
                      placeholder="氏名、住所、口座番号など"
                    />
                  </label>
                  <TextStyleFields
                    value={{ fontFamily, fontWeight, fontStyle, underline }}
                    disabled={!!busy}
                    onChange={(change) => {
                      if (change.fontFamily) setFontFamily(change.fontFamily);
                      if (change.fontWeight) setFontWeight(change.fontWeight);
                      if (change.fontStyle) setFontStyle(change.fontStyle);
                      if (change.underline !== undefined)
                        setUnderline(change.underline);
                    }}
                  />
                  <div className="two-fields">
                    <label>
                      文字サイズ
                      <NumericField
                        aria-label="文字サイズ"
                        min={6}
                        max={96}
                        value={fontSize}
                        suffix="pt"
                        disabled={!!busy}
                        onChange={(value) => {
                          placementSettings.current.fontSize = value;
                          setFontSize(value);
                        }}
                      />
                    </label>
                    <label>
                      文字色
                      <input
                        className="color-input"
                        type="color"
                        value={color}
                        onChange={(e) => setColor(e.target.value)}
                      />
                    </label>
                  </div>
                  <button
                    className="secondary full"
                    onClick={() => setText(today())}
                  >
                    今日の日付を入力
                  </button>
                  <p className="help-text">
                    用紙をクリックすると、その場で入力できます。ここで先に入力してから配置することもできます。
                  </p>
                  <div className="section-divider" />
                  <h3>登録情報から入力</h3>
                  {Object.entries(profile).filter(([, v]) => v).length ? (
                    <div className="quick-values">
                      {Object.entries(profile)
                        .filter(([, v]) => v)
                        .map(([k, v]) => (
                          <button key={k} onClick={() => setText(v)}>
                            <span>{k}</span>
                            <strong>{v}</strong>
                          </button>
                        ))}
                    </div>
                  ) : (
                    <p className="muted small">
                      氏名や住所を登録すると、毎回入力する手間が省けます。
                    </p>
                  )}
                  <button
                    className="text-button"
                    onClick={() => setProfileOpen(true)}
                  >
                    <UserRound size={15} />
                    登録情報を編集
                  </button>
                </>
              ) : tool === "stamp" ? (
                <>
                  <button
                    className="secondary full"
                    onClick={() => stampInput.current?.click()}
                  >
                    <Upload size={15} />
                    画像から印鑑を登録
                  </button>
                  <p className="help-text">
                    画像の背景を透過して登録できます。
                    <br />
                    個人印・会社印を選んで押印できます。
                  </p>
                  {stampLibrary.length > 0 && (
                    <div className="stamp-library" aria-label="登録済み印鑑">
                      {stampLibrary.map((item) => (
                        <button
                          key={item.id}
                          className={item.id === stamp.id ? "active" : ""}
                          onClick={() => {
                            setStamp(item);
                            localStorage.setItem(
                              "luma.stamp.v1",
                              JSON.stringify(item),
                            );
                          }}
                        >
                          <span className="stamp-library-image">
                            <AnnotationVisual
                              annotation={{
                                ...stampPreview,
                                text: item.name,
                                type: item.dataUrl ? "image" : "stamp",
                                dataUrl: item.dataUrl,
                                stampShape: item.shape,
                              }}
                            />
                          </span>
                          <span>{item.name}</span>
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="stamp-preview">
                    <AnnotationVisual annotation={stampPreview} />
                  </div>
                  <label>
                    {stamp.dataUrl ? "印鑑の名前" : "印鑑に入れる名前"}
                    <input
                      value={stamp.name}
                      maxLength={stamp.dataUrl ? 40 : 8}
                      placeholder="例：山田"
                      onChange={(e) =>
                        setStamp({
                          ...stamp,
                          name: e.target.value,
                        })
                      }
                    />
                  </label>
                  {!stamp.dataUrl && (
                    <div className="segmented">
                      <button
                        className={stamp.shape === "circle" ? "active" : ""}
                        onClick={() =>
                          setStamp({
                            ...stamp,
                            shape: "circle",
                            dataUrl: undefined,
                          })
                        }
                      >
                        丸印
                      </button>
                      <button
                        className={stamp.shape === "square" ? "active" : ""}
                        onClick={() =>
                          setStamp({
                            ...stamp,
                            shape: "square",
                            dataUrl: undefined,
                          })
                        }
                      >
                        角印
                      </button>
                    </div>
                  )}
                  <label>
                    大きさ{" "}
                    <span className="muted">
                      {Math.round((stampSize * 25.4) / 72)} mm
                    </span>
                    <NumericField
                      aria-label="印鑑の大きさ"
                      min={8}
                      max={1000}
                      value={stampSize}
                      onChange={rememberStampSize}
                      suffix="pt"
                      disabled={!!busy}
                    />
                  </label>
                  <button
                    className="secondary full"
                    onClick={() => stampInput.current?.click()}
                  >
                    <Upload size={15} />
                    印影画像を取り込む
                  </button>
                  <p className="help-text">
                    プレビューの市松模様は透明部分です。
                    <br />
                    用意できたら押したい場所をクリック。
                  </p>
                  <button className="primary full" onClick={saveStamp}>
                    <Check size={16} />
                    この印鑑を登録
                  </button>
                  {stamp.dataUrl && (
                    <button
                      className="text-button full"
                      onClick={() => setStamp({ name: "", shape: "circle" })}
                    >
                      名前から作り直す
                    </button>
                  )}
                  <button
                    className="text-button full"
                    onClick={() => {
                      const next = stampLibrary.filter(
                        (item) => item.id !== stamp.id,
                      );
                      localStorage.setItem(
                        "luma.stamps.v1",
                        JSON.stringify(next),
                      );
                      setStampLibrary(next);
                      localStorage.removeItem("luma.stamp.v1");
                      setStamp({ name: "", shape: "circle" });
                      notify("登録した印鑑を消去しました。");
                    }}
                  >
                    この印鑑の登録を削除
                  </button>
                  <p className="help-text small">
                    印影は画像です。改ざん検知を付けるには、仕上げに「署名して保存」を使います。
                  </p>
                </>
              ) : tool === "image" ? (
                <>
                  <button
                    className="secondary full"
                    onClick={() => imageInput.current?.click()}
                  >
                    <ImagePlus size={17} />
                    画像を選ぶ
                  </button>
                  {imageData && (
                    <img
                      className="image-preview"
                      src={imageData.dataUrl}
                      alt="配置する画像"
                    />
                  )}
                  <p className="help-text">
                    PNG・JPEG（2MBまで）。画像を選んでから用紙をクリックしてください。
                  </p>
                </>
              ) : tool === "check" ? (
                <>
                  <div className="check-preview">
                    <Check size={44} />
                  </div>
                  <p className="help-text">
                    チェックを入れる場所をクリック。配置後に大きさや色も変えられます。
                  </p>
                </>
              ) : (
                <>
                  <div className="workflow-step">
                    <span>
                      <Type size={19} />
                    </span>
                    <div>
                      <h3>必要事項を記入</h3>
                      <p>名前や口座番号を、記入欄へ。</p>
                    </div>
                  </div>
                  <div className="workflow-step">
                    <span>
                      <Stamp size={19} />
                    </span>
                    <div>
                      <h3>印鑑を押す</h3>
                      <p>名前から作成、画像も使えます。</p>
                    </div>
                  </div>
                  <div className="workflow-step">
                    <span>
                      <Download size={19} />
                    </span>
                    <div>
                      <h3>保存して返送</h3>
                      <p>記入済みPDFをメールに添付。</p>
                    </div>
                  </div>
                  <div className="section-divider" />
                  <div className="ai-intro">
                    <Sparkles size={22} />
                    <h3>いつもの記入を、AIに。</h3>
                    <p>
                      登録した名前・住所・口座情報を、書類の記入欄へ自動配置します。
                    </p>
                    <button
                      className="secondary full"
                      disabled={!pdf || signedInput}
                      onClick={() => {
                        setAiOpen(true);
                        setAiResult(null);
                      }}
                    >
                      AI自動記入を試す
                    </button>
                  </div>
                </>
              )}
              {pdf && !selected && (
                <>
                  <div className="section-divider" />
                  <h3>このページの操作</h3>
                  <fieldset className="page-actions" disabled={signedInput}>
                    <button
                      title="左へ移動"
                      aria-label="ページを前へ"
                      disabled={pageIndex === 0 || !!busy}
                      onClick={() => {
                        const current = flushInlineText();
                        const p = [...current.pages];
                        [p[pageIndex - 1], p[pageIndex]] = [
                          p[pageIndex],
                          p[pageIndex - 1],
                        ];
                        commit({ ...current, pages: p });
                      }}
                    >
                      <ArrowUp size={17} />
                    </button>
                    <button
                      aria-label="ページを後ろへ"
                      disabled={pageIndex === edits.pages.length - 1 || !!busy}
                      onClick={() => {
                        const current = flushInlineText();
                        const p = [...current.pages];
                        [p[pageIndex + 1], p[pageIndex]] = [
                          p[pageIndex],
                          p[pageIndex + 1],
                        ];
                        commit({ ...current, pages: p });
                      }}
                    >
                      <ArrowDown size={17} />
                    </button>
                    <button
                      aria-label="ページを右に回転"
                      disabled={!!busy}
                      onClick={() => {
                        const current = flushInlineText();
                        commit({
                          ...current,
                          pages: current.pages.map((p) =>
                            p.id === page.id
                              ? { ...p, rotation: (p.rotation + 90) % 360 }
                              : p,
                          ),
                        });
                      }}
                    >
                      <RotateCw size={17} />
                    </button>
                    <button
                      aria-label="ページを削除"
                      disabled={edits.pages.length === 1 || !!busy}
                      onClick={() => deletePage(page.id)}
                    >
                      <Trash2 size={17} />
                    </button>
                  </fieldset>
                </>
              )}
            </div>
          </aside>
        </div>
        <footer className="status-bar">
          <div>
            {!showPages && (
              <button
                className="text-button"
                onClick={() => setShowPages(true)}
              >
                ページ一覧
              </button>
            )}
            <span className="status-dot" />
            {busy ||
              (pdf
                ? `${edits.annotations.length}件の記入・押印`
                : "PDFを開く準備ができています")}
          </div>
          <div className="zoom-controls">
            <button
              aria-label="前のページ"
              disabled={!pdf || pageIndex <= 0}
              onClick={() => {
                activatePage(edits.pages[pageIndex - 1].id);
              }}
            >
              <ChevronLeft size={16} />
            </button>
            <span>
              {pdf ? `${pageIndex + 1} / ${edits.pages.length}` : "—"}
            </span>
            <button
              aria-label="次のページ"
              disabled={!pdf || pageIndex >= edits.pages.length - 1}
              onClick={() => {
                activatePage(edits.pages[pageIndex + 1].id);
              }}
            >
              <ChevronRight size={16} />
            </button>
            <span className="toolbar-divider" />
            <button
              aria-label="縮小"
              disabled={!pdf}
              onClick={() => viewport.zoomBy(-0.1)}
            >
              <ZoomOut size={16} />
            </button>
            <span data-testid="zoom-level">{Math.round(scale * 100)}%</span>
            <button
              aria-label="拡大"
              disabled={!pdf}
              onClick={() => viewport.zoomBy(0.1)}
            >
              <ZoomIn size={16} />
            </button>
            <button
              className="fit-button"
              onClick={() => fit()}
              disabled={!pdf}
            >
              幅に合わせる
            </button>
            <button
              className="fit-button"
              onClick={() => fit(true)}
              disabled={!pdf}
            >
              ページ全体に合わせる
            </button>
          </div>
        </footer>
        {(error || message) && (
          <div
            role={error ? "alert" : "status"}
            className={`toast ${error ? "error" : ""}`}
          >
            <Info size={18} />
            <span>{error || message}</span>
            <button
              aria-label="通知を閉じる"
              onClick={() => {
                setError("");
                setMessage("");
              }}
            >
              <X size={16} />
            </button>
          </div>
        )}
        {busy && (
          <div className="busy-indicator" role="status">
            <LoaderCircle size={18} />
            {busy}
          </div>
        )}
        <input
          hidden
          type="file"
          accept=".lumapdf"
          ref={projectInput}
          data-testid="project-input"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) {
              if (file.size > 100 * 1024 * 1024) {
                setProjectError("作業データは100MBまで読み込めます。");
                return;
              }
              void file
                .arrayBuffer()
                .then((bytes) => restoreProject(new Uint8Array(bytes)));
            }
          }}
        />
        <input
          hidden
          type="file"
          multiple
          accept="application/pdf,.pdf"
          ref={mergeInput}
          data-testid="merge-pdf-input"
          onChange={(event) => {
            const files = Array.from(event.target.files ?? []);
            event.target.value = "";
            void readMergeFiles(files);
          }}
        />
        <input
          hidden
          data-testid="pdf-input"
          ref={pdfInput}
          type="file"
          accept="application/pdf,.pdf"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void readFile(f);
            e.target.value = "";
          }}
        />
        <input
          hidden
          ref={imageInput}
          type="file"
          accept="image/png,image/jpeg"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void importImage(f, false);
            e.target.value = "";
          }}
        />
        <input
          hidden
          ref={stampInput}
          type="file"
          accept="image/png,image/jpeg"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void importImage(f, true);
            e.target.value = "";
          }}
        />
      </div>
      {pageMenu && edits.pages.some((p) => p.id === pageMenu.pageId) && (
        <PageContextMenu
          target={pageMenu}
          pageNumber={
            edits.pages.findIndex((p) => p.id === pageMenu.pageId) + 1
          }
          disabledReason={
            signedInput
              ? "署名付きPDFは閲覧専用です。"
              : edits.pages.length <= 1
                ? "最後の1ページは削除できません。"
                : undefined
          }
          onDelete={() => deletePage(pageMenu.pageId)}
          onExport={() => exportOnePage(pageMenu.pageId)}
          exportDisabled={signedInput || !!busy}
          onClose={closePageMenu}
        />
      )}
      {mergeOpen && (
        <MergeDialog
          files={mergeFiles}
          hasDocument={!!pdf}
          busy={!!busy}
          error={mergeError}
          onFilesChange={setMergeFiles}
          onAddFiles={chooseMergeFiles}
          onConfirm={mergeDocuments}
          onClose={() => {
            if (!busy) {
              setMergeOpen(false);
              setMergeFiles([]);
              setMergeError("");
            }
          }}
        />
      )}
      {aiSettingsOpen && (
        <AiSettingsDialog onClose={() => setAiSettingsOpen(false)} />
      )}
      {certificateGuideOpen && (
        <CertificateGuide
          onClose={() => setCertificateGuideOpen(false)}
          onChooseCertificate={
            pdf && window.lumaDesktop && !signedInput
              ? () => {
                  setCertificateGuideOpen(false);
                  setSignatureOpen(true);
                }
              : undefined
          }
        />
      )}
      {projectOpen && (
        <ProjectDialog
          busy={!!busy}
          canSave={!!pdf && !signedInput}
          error={projectError}
          onSave={saveProject}
          onOpen={openProject}
          onClose={() => {
            if (!busy) setProjectOpen(false);
          }}
        />
      )}
      {signatureOpen && (
        <SignatureDialog
          onClose={() => {
            if (!busy) setSignatureOpen(false);
          }}
          onSign={signAndSave}
        />
      )}
      {stampFile && (
        <StampImportDialog
          file={stampFile}
          onClose={() => setStampFile(null)}
          onSave={(result) => {
            const value: SavedStamp = {
              name: result.name,
              dataUrl: result.dataUrl,
              aspectRatio: result.width / result.height,
              shape: "circle",
            };
            if (registerStamp(value)) {
              setStampFile(null);
              setTool("stamp");
              setSelectedId(null);
            }
          }}
        />
      )}
      {profileOpen && (
        <ProfileDialog
          profile={profile}
          onClose={() => setProfileOpen(false)}
          onSave={(value) => {
            try {
              localStorage.setItem("luma.profile.v1", JSON.stringify(value));
              setProfile(value);
              setProfileOpen(false);
              notify(
                Object.keys(value).length
                  ? "登録情報を保存しました。"
                  : "登録情報を消去しました。",
              );
            } catch {
              setError("登録情報を保存できませんでした。");
            }
          }}
        />
      )}
      {printHelp && (
        <div className="modal-backdrop" onClick={() => setPrintHelp(false)}>
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="print-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-heading">
              <div>
                <Printer size={22} />
                <h2 id="print-title">ほかのアプリの印刷から取り込む</h2>
              </div>
              <button
                className="icon-button"
                aria-label="閉じる"
                onClick={() => setPrintHelp(false)}
              >
                <X size={20} />
              </button>
            </div>
            <p>Wordやブラウザーで作った書類を、PDFにしてすぐ編集できます。</p>
            <div className="os-guide">
              <h3>Windows</h3>
              <p>
                専用プリンターの設定後は、印刷先に「LumaStudio
                PDF」を選択。アプリを起動しておくと、受信したPDFが開きます。
              </p>
              <p className="help-text">
                初回は管理者権限で設定が必要です。設定前は「Microsoft Print to
                PDF」でPDFを保存して、この画面へドラッグできます。
              </p>
            </div>
            <div className="os-guide">
              <h3>Mac</h3>
              <p>
                PDFサービスの登録後は、印刷画面の「PDF」メニューから「LumaStudio
                PDF」を選択して開けます。
              </p>
              <p className="help-text">
                初回の登録手順は同梱のREADMEをご覧ください。
              </p>
            </div>
            {window.lumaDesktop && (
              <button
                className="secondary full"
                onClick={() =>
                  window.lumaDesktop
                    ?.openPrintInbox()
                    .catch(() => setError("受信フォルダーを開けませんでした。"))
                }
              >
                <FolderOpen size={17} />
                印刷の受信フォルダーを開く
              </button>
            )}
            <p className="help-text">
              MVPではOS連携を別途セットアップします。書類の編集と印刷は、どちらのOSも同じ画面で操作できます。
            </p>
          </section>
        </div>
      )}
      {aiOpen && (
        <div className="modal-backdrop">
          <section
            className="modal ai-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="ai-title"
          >
            <div className="modal-heading">
              <div>
                <Sparkles size={22} />
                <h2 id="ai-title">AIで記入欄を埋める</h2>
              </div>
              <button
                className="icon-button"
                aria-label="閉じる"
                disabled={!!busy}
                onClick={() => setAiOpen(false)}
              >
                <X size={20} />
              </button>
            </div>
            {!aiResult ? (
              <>
                <p>
                  表示中の<strong>{pageIndex + 1}ページ目</strong>
                  に、登録した情報の配置候補を作ります。
                </p>
                <div className="ai-profile-summary">
                  {Object.entries(profile)
                    .filter(([, v]) => v)
                    .map(([k, v]) => (
                      <div key={k}>
                        <span>{k}</span>
                        <strong>{v}</strong>
                      </div>
                    ))}
                  {!Object.values(profile).some(Boolean) && (
                    <p>まだ情報が登録されていません。</p>
                  )}
                  <button
                    className="text-button"
                    onClick={() => setProfileOpen(true)}
                    disabled={!!busy}
                  >
                    <UserRound size={15} />
                    登録情報を編集
                  </button>
                </div>
                <label>
                  記入日
                  <input
                    value={entryDate}
                    onChange={(e) => setEntryDate(e.target.value)}
                    disabled={!!busy}
                  />
                </label>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={includeStamp}
                    onChange={(e) => setIncludeStamp(e.target.checked)}
                    disabled={!!busy || !(stamp.name || stamp.dataUrl)}
                  />
                  登録印鑑も押印欄へ配置する
                  {!(stamp.name || stamp.dataUrl) && (
                    <span className="muted">（印鑑が未登録）</span>
                  )}
                </label>
                <div className="ai-disclosure">
                  <Info size={18} />
                  <p>
                    このページの画像と上記の登録情報をOpenAIへ送信します。AIが作った候補を選び、配置後も文字や位置を編集できます。未登録の情報は推測して埋めません。
                  </p>
                </div>
                <button
                  className="primary full"
                  disabled={!!busy}
                  onClick={runAi}
                >
                  {busy ? <LoaderCircle size={17} /> : <Sparkles size={17} />}
                  OpenAIに送信して候補を作る
                </button>
              </>
            ) : (
              <>
                <p>
                  配置する項目を選んでください。
                  <strong>
                    内容と位置は、配置後に用紙上で確認してください。
                  </strong>
                </p>
                <div className="ai-proposals">
                  {aiResult.placements.map((p, i) => (
                    <label key={i}>
                      <input
                        type="checkbox"
                        checked={aiSelection.includes(i)}
                        onChange={(e) =>
                          setAiSelection(
                            e.target.checked
                              ? [...aiSelection, i]
                              : aiSelection.filter((n) => n !== i),
                          )
                        }
                      />
                      <span>
                        <small>{p.field}</small>
                        <strong>
                          {p.type === "stamp"
                            ? `印鑑：${stamp.name || "登録画像"}`
                            : p.text}
                        </strong>
                      </span>
                    </label>
                  ))}
                </div>
                {aiResult.placements.length === 0 && (
                  <p className="muted">
                    配置できる記入欄が見つかりませんでした。手動の記入機能をお使いください。
                  </p>
                )}
                {aiResult.notes.length > 0 && (
                  <div className="ai-notes">
                    {aiResult.notes.map((n, i) => (
                      <p key={i}>{n}</p>
                    ))}
                  </div>
                )}
                <div className="modal-actions">
                  <button
                    className="secondary"
                    onClick={() => setAiResult(null)}
                  >
                    戻る
                  </button>
                  <button
                    className="primary"
                    disabled={!aiSelection.length}
                    onClick={applyAi}
                  >
                    <Check size={17} />
                    {aiSelection.length}件を配置して編集
                  </button>
                </div>
              </>
            )}
            {error && (
              <p className="inline-error" role="alert">
                {error}
              </p>
            )}
          </section>
        </div>
      )}
      <div id="print-area" aria-hidden="true" />
    </>
  );
}
