import PDFDocument from "pdfkit";
import QRCode from "qrcode";

/* ============================================================
   Renders a certificate as a PDF and streams it to `stream`.
   A4 landscape.

   The QR encodes the PUBLIC verify URL, not the holder's data.
   Scanning takes an employer to our page, where the truth
   lives — rather than trusting text baked into a PDF that
   anyone could edit in a word processor.
   ============================================================ */

const INK = "#0B1418";
const MOSS = "#1D4B3E";
const GOLD = "#E8B33C";
const SLATE = "#5C6B70";
const PAPER = "#FBFAF6";

function fmtDate(d) {
  if (!d) return "—";
  const date = new Date(String(d).replace(" ", "T"));
  return date.toLocaleDateString("en-GB", {
    day: "numeric", month: "long", year: "numeric",
  });
}

export async function renderCertificate(cert, verifyUrl, stream) {
  const doc = new PDFDocument({
    size: "A4",
    layout: "landscape",
    margins: { top: 0, bottom: 0, left: 0, right: 0 },
  });
  doc.pipe(stream);

  const W = doc.page.width;
  const H = doc.page.height;

  /* background + borders */
  doc.rect(0, 0, W, H).fill(PAPER);
  doc.rect(24, 24, W - 48, H - 48).lineWidth(2).stroke(INK);
  doc.rect(32, 32, W - 64, H - 64).lineWidth(0.5).stroke(GOLD);

  /* header band */
  doc.rect(32, 32, W - 64, 70).fill(INK);
  doc.fillColor(PAPER).font("Helvetica-Bold").fontSize(22)
     .text("Ascend", 60, 55, { continued: true })
     .fillColor(GOLD).text("AI");
  doc.fillColor("#B8B4AC").font("Helvetica").fontSize(9)
     .text("HUYE · RWANDA", 60, 80);
  doc.fillColor(PAPER).font("Helvetica").fontSize(9)
     .text("CERTIFICATE OF COMPLETION", W - 300, 68, {
       width: 240, align: "right", characterSpacing: 2,
     });

  /* title */
  doc.fillColor(SLATE).font("Helvetica").fontSize(11)
     .text("THIS CERTIFIES THAT", 0, 150, { align: "center", characterSpacing: 3 });

  doc.fillColor(INK).font("Helvetica-Bold").fontSize(38)
     .text(cert.holder_name, 60, 178, { width: W - 120, align: "center" });

  const nameW = Math.min(doc.widthOfString(cert.holder_name) + 80, W - 160);
  doc.moveTo((W - nameW) / 2, 232).lineTo((W + nameW) / 2, 232)
     .lineWidth(1).stroke(GOLD);

  /* body */
  doc.fillColor(SLATE).font("Helvetica").fontSize(12)
     .text("has successfully completed", 0, 250, { align: "center" });
  doc.fillColor(MOSS).font("Helvetica-Bold").fontSize(20)
     .text(cert.program_name, 60, 274, { width: W - 120, align: "center" });

  const span = cert.started_on && cert.ended_on
    ? `${fmtDate(cert.started_on)}  —  ${fmtDate(cert.ended_on)}`
    : fmtDate(cert.ended_on);
  doc.fillColor(SLATE).font("Helvetica").fontSize(11)
     .text(cert.hours ? `${span}   ·   ${cert.hours} hours` : span, 0, 308, { align: "center" });

  /* QR → verify URL */
  const qrPng = await QRCode.toBuffer(verifyUrl, {
    errorCorrectionLevel: "M", margin: 0, width: 200,
    color: { dark: INK, light: PAPER },
  });
  const qrSize = 90, qrX = 70, qrY = H - 175;
  doc.image(qrPng, qrX, qrY, { width: qrSize });
  doc.fillColor(SLATE).font("Helvetica").fontSize(7.5)
     .text("SCAN TO VERIFY", qrX, qrY + qrSize + 6, {
       width: qrSize, align: "center", characterSpacing: 1,
     });

  /* serial + issue (centre) */
  doc.fillColor(INK).font("Courier-Bold").fontSize(13)
     .text(cert.serial, 0, H - 150, { align: "center" });
  doc.fillColor(SLATE).font("Helvetica").fontSize(8)
     .text(`Issued ${fmtDate(cert.issued_at)}`, 0, H - 132, { align: "center" });
  doc.fillColor(SLATE).fontSize(7.5)
     .text(verifyUrl, 0, H - 118, { align: "center" });

  /* signature (right) */
  const sigX = W - 240, sigY = H - 130;
  doc.fillColor(SLATE).font("Helvetica").fontSize(7)
     .text("Digitally signed by:", sigX, sigY - 14, { width: 170, align: "center" });
  doc.moveTo(sigX, sigY).lineTo(sigX + 170, sigY).lineWidth(0.75).stroke(INK);
  doc.fillColor(INK).font("Helvetica-Bold").fontSize(10)
     .text("NTAMBARA Etienne", sigX, sigY + 6, { width: 170, align: "center" });
  doc.fillColor(SLATE).font("Helvetica").fontSize(8)
     .text("Director, Ascend AI", sigX, sigY + 20, { width: 170, align: "center" });

  doc.end();
}