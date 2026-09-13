/** Kis "ⓘ" jelzés, natív `title` tooltippel — helyi kontextuális magyarázat egy címkéhez/gombhoz. */
export default function InfoTooltip({ text }: { text: string }) {
  return (
    <span
      title={text}
      aria-label={text}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: "1rem",
        height: "1rem",
        borderRadius: "50%",
        border: "1px solid var(--color-border)",
        color: "var(--color-text-muted)",
        fontSize: "0.7rem",
        lineHeight: 1,
        cursor: "help",
        marginLeft: "0.35rem",
      }}
    >
      ?
    </span>
  );
}
