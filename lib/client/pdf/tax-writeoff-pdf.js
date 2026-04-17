import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

export function generateTaxWriteoffPDF(events, storeName, period) {
  const doc = new jsPDF();

  doc.setFontSize(16).setFont(undefined, "bold");
  doc.text("SynaptOS - Tax Write-off Report", 14, 20);
  doc.setFontSize(10).setFont(undefined, "normal");
  doc.text(`Store: ${storeName}`, 14, 30);
  doc.text(`Period: ${period}`, 14, 36);
  doc.text("Prepared under: Decision 222/QD-TTg Circular Economy Plan", 14, 42);

  const totalItems = events.length;
  const totalOriginal = events.reduce((sum, event) => sum + Number(event.original_value ?? 0), 0);
  const totalWriteoff = events.reduce((sum, event) => sum + Number(event.writeoff_value ?? 0), 0);

  doc.setFontSize(11).setFont(undefined, "bold");
  doc.text(
    `Total items: ${totalItems}   Original value: ${totalOriginal.toLocaleString()}₫   Write-off: ${totalWriteoff.toLocaleString()}₫`,
    14,
    52
  );

  autoTable(doc, {
    startY: 60,
    head: [["SKU", "Category", "Qty", "Original (₫)", "Write-off (₫)", "EOL Time", "Routing"]],
    body: events.map((event) => [
      event.sku_id,
      event.category,
      Number(event.quantity ?? 0).toLocaleString(),
      Number(event.original_value ?? 0).toLocaleString(),
      Number(event.writeoff_value ?? 0).toLocaleString(),
      new Date(event.eol_at).toLocaleString(),
      event.routing_destination,
    ]),
  });

  doc.save(`tax-writeoff-${period}.pdf`);
}
