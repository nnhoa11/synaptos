import "./globals.css";

export const metadata = {
  title: "SynaptOS Prototype",
  description:
    "Retail markdown operations prototype for fresh-food inventory risk, approvals, and shelf-label propagation.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
