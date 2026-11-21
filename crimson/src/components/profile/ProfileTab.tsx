import { useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useLCU } from '../../contexts/LCUContext';
import { 
  User, ShieldCheck, Key, LogOut, Check, AlertCircle, 
  Sparkles, Lock, ArrowLeft, Copy
} from 'lucide-react';
import { SUPABASE_URL } from '../../lib/supabase';

export default function ProfileTab() {
  const { user, isPremium, session, signOut } = useAuth();
  const { setTab } = useLCU();

  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const handleCopyId = () => {
    if (user?.id) {
      navigator.clipboard.writeText(user.id);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);

    if (newPassword.length < 6) {
      setErrorMsg('Le nouveau mot de passe doit comporter au moins 6 caractères.');
      return;
    }

    if (newPassword !== confirmPassword) {
      setErrorMsg('Les mots de passe ne correspondent pas.');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`${SUPABASE_URL}/api/auth/change-password`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session?.access_token || ''}`,
        },
        body: JSON.stringify({
          old_password: oldPassword,
          new_password: newPassword,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || data.error || 'Erreur lors du changement de mot de passe.');
      }

      setSuccessMsg('Votre mot de passe a été modifié avec succès.');
      setOldPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err: any) {
      setErrorMsg(err.message || 'Une erreur est survenue.');
    } finally {
      setLoading(false);
    }
  };

  const handleSignOut = async () => {
    try {
      await signOut();
    } catch (err) {
      console.error('Logout error', err);
    }
  };

  const initial = (user?.email?.[0] || 'C').toUpperCase();

  return (
    <div className="w-full max-w-4xl mx-auto space-y-10 mt-8 px-6 pb-24 animate-in fade-in slide-in-from-bottom-6 duration-700">
      {/* Top Header Navigation */}
      <div className="flex items-center justify-between border-b border-white/5 pb-8">
        <div className="flex items-center gap-5">
          {/* Refined Dark Matte Avatar */}
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-white/10 to-black/60 border border-white/10 flex items-center justify-center text-white text-2xl font-black font-mono shadow-xl">
            {initial}
          </div>
          <div>
            <div className="flex items-center gap-3">
              <h2 className="text-2xl font-black text-white tracking-wide">{user?.email}</h2>
              {isPremium && (
                <span className="px-2.5 py-0.5 rounded-full bg-gradient-to-r from-red-600/30 to-red-500/10 border border-red-500/30 text-red-400 text-[10px] font-black uppercase tracking-wider flex items-center gap-1">
                  <Sparkles className="w-3 h-3 text-red-400" />
                  Premium
                </span>
              )}
            </div>
            <div className="flex items-center gap-3 mt-1.5 text-[11px] font-bold uppercase tracking-wider">
              <span className="text-green-400 flex items-center gap-1">
                <ShieldCheck className="w-3.5 h-3.5" />
                Compte Vérifié
              </span>
              <span className="text-white/20">•</span>
              <span className="text-white/40">Serveur PostgreSQL Centralisé</span>
            </div>
          </div>
        </div>

        <button
          onClick={() => setTab('home')}
          className="px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-white/70 hover:text-white text-[11px] font-black uppercase tracking-wider transition-all flex items-center gap-2"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Retour
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        {/* ACCOUNT INFO CARD */}
        <div className="bg-white/[0.02] border border-white/5 p-8 rounded-[2rem] flex flex-col justify-between space-y-6">
          <div>
            <div className="flex items-center gap-3 mb-6">
              <div className="p-2.5 bg-white/5 border border-white/10 rounded-xl text-white/70">
                <User className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-black text-white uppercase tracking-widest font-mono">Informations du Compte</h3>
                <span className="text-[10px] text-white/30 uppercase font-bold tracking-wider">Identifiants et statut</span>
              </div>
            </div>

            <div className="space-y-4">
              <div className="p-4 rounded-xl bg-black/40 border border-white/5">
                <span className="text-[9px] font-black text-white/40 uppercase tracking-widest block mb-1">Adresse Email</span>
                <span className="text-xs font-mono text-white select-all">{user?.email}</span>
              </div>

              <div className="p-4 rounded-xl bg-black/40 border border-white/5 flex items-center justify-between">
                <div>
                  <span className="text-[9px] font-black text-white/40 uppercase tracking-widest block mb-1">Identifiant Unique (UUID)</span>
                  <span className="text-[10px] font-mono text-white/60 truncate block max-w-[200px]">
                    {user?.id}
                  </span>
                </div>
                <button
                  onClick={handleCopyId}
                  className="p-2 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-white/50 hover:text-white transition-colors"
                  title="Copier l'UUID"
                >
                  {copied ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
              </div>

              <div className="p-4 rounded-xl bg-black/40 border border-white/5 flex items-center justify-between">
                <div>
                  <span className="text-[9px] font-black text-white/40 uppercase tracking-widest block mb-0.5">Statut de l'email</span>
                  <span className="text-xs font-bold text-green-400 uppercase tracking-wider">Vérifié & Authentifié</span>
                </div>
                <ShieldCheck className="w-5 h-5 text-green-400/80" />
              </div>
            </div>
          </div>

          {/* DÉCONNEXION BUTTON */}
          <div className="pt-4 border-t border-white/5">
            <button
              onClick={handleSignOut}
              className="w-full py-3.5 bg-red-600/10 hover:bg-red-600/20 border border-red-500/20 text-red-400 hover:text-red-300 rounded-xl text-xs font-black uppercase tracking-widest transition-all flex items-center justify-center gap-2"
            >
              <LogOut className="w-4 h-4" />
              Se déconnecter
            </button>
          </div>
        </div>

        {/* SECURITY & PASSWORD CARD */}
        <div className="bg-white/[0.02] border border-white/5 p-8 rounded-[2rem] space-y-6">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-white/5 border border-white/10 rounded-xl text-white/70">
              <Key className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-black text-white uppercase tracking-widest font-mono">Sécurité</h3>
              <span className="text-[10px] text-white/30 uppercase font-bold tracking-wider">Modifier votre mot de passe</span>
            </div>
          </div>

          <form onSubmit={handleChangePassword} className="space-y-4">
            <div>
              <label className="text-[9px] font-black text-white/40 uppercase tracking-widest block mb-1.5 pl-1">
                Ancien mot de passe
              </label>
              <input
                type="password"
                value={oldPassword}
                onChange={(e) => setOldPassword(e.target.value)}
                placeholder="Votre mot de passe actuel..."
                autoComplete="current-password"
                className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-2.5 text-xs text-white outline-none focus:border-red-600 transition-colors"
              />
            </div>

            <div>
              <label className="text-[9px] font-black text-white/40 uppercase tracking-widest block mb-1.5 pl-1">
                Nouveau mot de passe
              </label>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Nouveau mot de passe (min 6 caractères)..."
                autoComplete="new-password"
                className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-2.5 text-xs text-white outline-none focus:border-red-600 transition-colors"
              />
            </div>

            <div>
              <label className="text-[9px] font-black text-white/40 uppercase tracking-widest block mb-1.5 pl-1">
                Confirmer le nouveau mot de passe
              </label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Confirmez le nouveau mot de passe..."
                autoComplete="new-password"
                className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-2.5 text-xs text-white outline-none focus:border-red-600 transition-colors"
              />
            </div>

            {errorMsg && (
              <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/20 px-4 py-3 rounded-xl text-[10px] font-black text-red-400 uppercase tracking-wider">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{errorMsg}</span>
              </div>
            )}

            {successMsg && (
              <div className="flex items-center gap-2 bg-green-500/10 border border-green-500/20 px-4 py-3 rounded-xl text-[10px] font-black text-green-400 uppercase tracking-wider">
                <Check className="w-4 h-4 shrink-0" />
                <span>{successMsg}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={loading || !newPassword || !confirmPassword}
              className="w-full py-3.5 bg-red-600 hover:bg-red-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-black uppercase tracking-widest rounded-xl transition-all shadow-[0_0_20px_rgba(220,38,38,0.25)] flex items-center justify-center gap-2"
            >
              <Lock className="w-4 h-4" />
              {loading ? 'Modification...' : 'Mettre à jour le mot de passe'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
