import "./globals.css";

export const metadata = {
  title: "SynaptOS",
  description:
    "Agentic AI operations platform for fresh-food retail pricing, inventory control, and store execution.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className="app-root">{children}</body>
    </html>
  );
}
