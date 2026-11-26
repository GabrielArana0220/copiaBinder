interface StatusCardProps {
  title: string;
  description: string;
  label: string;
}

export function StatusCard({ title, description, label }: StatusCardProps) {
  return (
    <article className="status-card">
      <span className="status-card__label">{label}</span>
      <h2>{title}</h2>
      <p>{description}</p>
    </article>
  );
}
