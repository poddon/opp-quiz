declare module "qrcode" {
  type Options = {
    type?: "svg";
    errorCorrectionLevel?: "L" | "M" | "Q" | "H";
    margin?: number;
    width?: number;
    color?: { dark?: string; light?: string };
  };
  const QRCode: { toString(text: string, options?: Options): Promise<string> };
  export default QRCode;
}
