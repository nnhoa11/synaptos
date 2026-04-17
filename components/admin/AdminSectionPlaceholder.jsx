import Badge from "@/components/ui/Badge";
import Card from "@/components/ui/Card";

export default function AdminSectionPlaceholder({ description, highlights = [], tag = "Foundation", title }) {
  return (
    <section className="page-shell">
      <header className="page-header">
        <p className="page-eyebrow">{tag}</p>
        <h1 className="page-title">{title}</h1>
        <p className="page-subtitle">{description}</p>
      </header>

      <div className="placeholder-grid">
        {highlights.map((item) => (
          <Card key={item.label} padded className="placeholder-stat">
            <Badge tone={item.tone ?? "blue"}>{item.label}</Badge>
            <div className="placeholder-value">{item.value}</div>
            <p className="placeholder-copy">{item.copy}</p>
          </Card>
        ))}
      </div>

      <Card>
        <Card.Header
          subtitle="This section is scaffolded and ready for the phase-specific implementation."
          title="Build Status"
        />
        <Card.Body>
          <p className="placeholder-copy">
            The new admin route group, design system, and navigation shell are active. The detailed
            screen logic for this section lands in the next implementation phase.
          </p>
        </Card.Body>
      </Card>
    </section>
  );
}
