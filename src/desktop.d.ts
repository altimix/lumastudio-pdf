export {};
declare global {
  interface Window {
    lumaDesktop?: {
      openPdf(): Promise<{ name: string; data: number[] } | null>;
      openPdfs(): Promise<{ name: string; data: number[] }[]>;
      openProject(): Promise<{ name: string; data: number[] } | null>;
      saveProject(data: number[], suggestedName: string): Promise<boolean>;
      savePdf(data: number[], suggestedName: string): Promise<boolean>;
      printPdf(data: number[]): Promise<void>;
      onOpenPdf(
        callback: (file: {
          name: string;
          data: number[];
        }) => void | Promise<void>,
      ): () => void;
      getPrintInbox(): Promise<string>;
      openPrintInbox(): Promise<void>;
      autofill(payload: {
        pages: {
          pageId: string;
          width: number;
          height: number;
          imageDataUrl: string;
        }[];
        profile: Record<string, string>;
        stamp: { enabled: boolean; name: string };
      }): Promise<{
        placements: {
          pageId: string;
          type: "text" | "stamp";
          field: string;
          text: string;
          x: number;
          y: number;
          width: number;
          height: number;
        }[];
        notes: string[];
      }>;
      getAiStatus(): Promise<{ available: boolean; model: string }>;
      getAiSettings(): Promise<{
        available: boolean;
        model: string;
        source: "saved" | "environment" | "none";
        saved: boolean;
        hasStoredSettings: boolean;
        canStore: boolean;
        warning: string;
      }>;
      saveAiSettings(input: {
        key: string;
        model: string;
      }): Promise<{
        available: boolean;
        model: string;
        source: "saved" | "environment" | "none";
        saved: boolean;
        hasStoredSettings: boolean;
        warning: string;
      }>;
      removeAiSettings(): Promise<{
        available: boolean;
        model: string;
        source: "saved" | "environment" | "none";
        saved: boolean;
        hasStoredSettings: boolean;
        warning: string;
      }>;
      openHelpLink(id: string): Promise<void>;
      chooseCertificate(): Promise<{ name: string } | null>;
      inspectCertificate(password: string): Promise<{
        subject: string;
        issuer: string;
        validFrom: string;
        validTo: string;
        fingerprint: string;
        selfSigned: boolean;
      }>;
      signAndSavePdf(
        data: number[],
        suggestedName: string,
        options: { password: string; reason: string; location: string },
      ): Promise<boolean>;
    };
  }
}
