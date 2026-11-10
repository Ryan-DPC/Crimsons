type Props = {
  title?: string;
  hint?: string;
};

/** Empty surface when Crimsons has no relevant plugin installed. */
export default function PluginEmptyState({
  title = 'Aucun plugin',
  hint = 'Crimsons ne livre aucun pack. Installez un plugin StreamDock pour activer cette page.',
}: Props) {
  return (
    <div className="w-full flex-1 flex items-center justify-center px-8 py-24">
      <div className="max-w-md text-center space-y-3">
        <p className="text-sm font-black text-white uppercase tracking-[0.2em]">{title}</p>
        <p className="text-[10px] text-white/30 font-bold uppercase tracking-widest leading-relaxed">
          {hint}
        </p>
      </div>
    </div>
  );
}
