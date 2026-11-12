# Paiements CRIMSONS (backend Stripe) — Suisse

Squelette **backend-only** : les Edge Functions et tables existent ; **aucun CTA de paiement actif** dans l’UI tant que `PAYMENTS_ENABLED` / `VITE_PAYMENTS_ENABLED` restent `false`.

> Ce document n’est **pas** un conseil juridique définitif. Valider TVA, CGV et obligations B2C avec une **fiduciaire / un avocat** en Suisse.

---

## 0. Grille tarifaire figée (produit)

Décision produit validée — **CHF**, hors conseils TVA. À afficher / facturer ainsi ; **ne pas inventer** de Price IDs Stripe dans le repo (créés au Dashboard quand un plugin est prêt).

| Offre | Prix | Notes |
| --- | --- | --- |
| **App CRIMSONS** | **Free** | Toujours gratuite |
| **Plugin solo** (mensuel) | **5.99 CHF / mois** | Prix de base figé |
| **Plugin solo** (annuel, −2 mois) | **59.90 CHF / an** | `5.99 × 10` ; référence ×12 = **71.88 CHF** |
| **Premium** (mensuel, suggéré) | **9.90 CHF / mois** | Pack global optionnel |
| **Premium** (annuel) | **99 CHF / an** | Pack global optionnel |
| **Full lifetime early bird** | **69.99 CHF** (quota limité) | Option user — **pas forcément** Stripe encore ; **attention cannibalisation** vs annuel plugin **59.90** |

### Règles anti-double-charge

- **Pas de double facturation app + plugin** : l’app reste free ; on monétise le **plugin** (ou, plus tard, un Premium global optionnel).
- Un abonnement **plugin** ne doit pas aussi facturer un « accès app ».
- Si un **Premium global** est activé : il remplace / couvre les plugins inclus — pas d’empilement app + pack + chaque plugin sans règle claire (à figer avant activation live).
- Lifetime **69.99** vs annuel plugin **59.90** : le lifetime doit rester **quota limité**, sinon il cannibalise l’abonnement annuel.

### Stripe Dashboard (quand un plugin est prêt)

1. Produit Stripe **par plugin** (ex. « CRIMSONS — Spotify »), devise **CHF**.
2. Price récurrent **5.99 CHF / mois** → copier l’ID `price_…` dans les secrets (pas dans git).
3. Price annuel **59.90 CHF / an** (même produit) quand l’offre annuelle est activée.
4. Premium global (si lancé) : Prices **9.90 CHF / mois** et **99 CHF / an**.
5. Lifetime early bird **69.99 CHF** : one-shot / payment link seulement si vous décidez de le vendre (quota limité) ; sinon rester hors Stripe.
6. Ne **pas** créer de Price « app » en parallèle du plugin si cela double-charge — le squelette actuel `STRIPE_PRICE_PREMIUM_*` est un **placeholder technique** (mensuel/annuel) à mapper vers le 1er produit réel (plugin ou Premium global), pas une 2ᵉ grille.

Labels catalogue / UI (placeholders produit) : `5.99 CHF/mois` · `59.90 CHF/an` (Premium : `9.90 CHF/mois` · `99 CHF/an` si affiché). Pas de `price_` hardcodé.

---

## 1. Pourquoi Stripe (compte CH)

| Critère | Stripe Suisse |
| --- | --- |
| Encaissement | Cartes + méthodes EU/CH via un seul compte |
| Payouts | Vers **IBAN suisse** (CHF/EUR selon config) après KYC |
| Test | Mode test complet (cartes 4242…, webhooks CLI) |
| Abonnements | Checkout + Customer Portal natifs (mensuel / annuel) |
| Entitlement | Webhooks → `profiles.is_premium` (déjà lu par sidecar + UI) |

Le sidecar Rust écoute en **localhost** (`40510`) : il **ne peut pas** recevoir les webhooks Stripe. D’où des **Supabase Edge Functions** HTTPS publiques.

Alternatives écartées pour ce squelette : PayPal (moins propre pour les abonnements + entitlement), Twint direct (intégration plus lourde, souvent live-only).

---

## 2. Ce qui est implémenté

| Pièce | Chemin |
| --- | --- |
| Migration SQL | `supabase/migrations/20261112113640_stripe_billing.sql` |
| Tables | `stripe_customers`, `subscriptions`, `payments`, `stripe_webhook_events` |
| Sync Premium | `sync_premium_from_subscriptions(user_id)` → `profiles.is_premium` (+ conserve l’allowlist email) |
| Edge Function | `create-checkout-session` — Checkout abonnement |
| Edge Function | `create-portal-session` — portail client |
| Edge Function | `stripe-webhook` — `checkout.session.completed`, `customer.subscription.*`, `invoice.paid` |
| Helpers Deno | `supabase/functions/_shared/payments.ts` |
| Helpers Rust | `server/src/payments.rs` (mapping price → plan, gate live, mock signature) |
| Stub UI | `crimson/src/lib/payments.ts` + garde dans `SettingsTab` |
| Exemples secrets | `supabase/.env.example`, `crimson/.env.example` |

### Endpoints (après déploiement des functions)

```
POST https://<project>.supabase.co/functions/v1/create-checkout-session
  Authorization: Bearer <supabase_access_token>
  Body: { "plan": "premium_monthly" | "premium_yearly" }
  → { "id", "url", "mode" }

POST https://<project>.supabase.co/functions/v1/create-portal-session
  Authorization: Bearer <supabase_access_token>
  → { "url" }

POST https://<project>.supabase.co/functions/v1/stripe-webhook
  Header: Stripe-Signature
  (verify_jwt = false ; signature Stripe obligatoire)
```

---

## 3. Configurer Stripe CH et récupérer l’argent (payouts)

1. Créer un compte **Stripe Business** avec pays **Suisse**.
2. Compléter le **KYC** (pièce d’identité ; extrait du registre du commerce si société).
3. Ajouter un **compte bancaire IBAN CH** dans *Settings → Payouts* (ou *Balances → Payouts*).
4. Choisir le calendrier de payouts (quotidien / hebdo). Les fonds des paiements réussis arrivent sur le solde Stripe puis sont **versés automatiquement** sur l’IBAN (délais selon méthode / risque).
5. Quand un **plugin** est prêt à l’encaissement : créer un **Produit** Stripe pour ce plugin + Price **5.99 CHF / mois** (et **59.90 CHF / an**). Voir §0. Ne pas créer de produits « fantômes » avant.
6. Copier les Price IDs → secrets `STRIPE_PRICE_PREMIUM_MONTHLY` / `STRIPE_PRICE_PREMIUM_YEARLY` (noms historiques du squelette = 1er price mensuel/annuel branché ; **pas** de IDs dans le repo).
7. Clés API **test** (`sk_test_…`) d’abord. Live (`sk_live_…`) seulement avec `STRIPE_LIVE_ENABLED=true`.
8. Appliquer la migration SQL sur le projet Supabase, déployer les Edge Functions, puis :
   ```bash
   supabase secrets set --env-file supabase/.env   # sans committer le fichier réel
   ```
9. Webhook Dashboard (live) ou Stripe CLI (test) → URL `…/functions/v1/stripe-webhook`.

### Tester avec Stripe CLI

```bash
# Terminal A — forward webhooks
stripe listen --forward-to https://fkzywcoymqyfoufvtedl.supabase.co/functions/v1/stripe-webhook
# ou en local :
# supabase functions serve stripe-webhook --env-file supabase/functions/.env
# stripe listen --forward-to http://127.0.0.1:54321/functions/v1/stripe-webhook

# Copier le whsec_… affiché → STRIPE_WEBHOOK_SECRET

# Terminal B — déclencher un event
stripe trigger checkout.session.completed
stripe trigger customer.subscription.updated
stripe trigger invoice.paid
```

Checkout manuel (avec `PAYMENTS_ENABLED=true` et JWT user) :

```bash
curl -s -X POST "$SUPABASE_URL/functions/v1/create-checkout-session" \
  -H "Authorization: Bearer $USER_ACCESS_TOKEN" \
  -H "apikey: $SUPABASE_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"plan":"premium_monthly"}'
# Ouvrir l’URL renvoyée → carte test 4242…
```

Après paiement : `profiles.is_premium = true` ; dans l’app **Paramètres → Actualiser le statut**.

---

## 4. Méthodes de paiement en **test mode**

| Méthode | Test mode | Notes |
| --- | --- | --- |
| Cartes Visa/Mastercard | Oui | `4242 4242 4242 4242`, exp future, CVC quelconque |
| Carte refusée | Oui | `4000 0000 0000 0002` |
| 3DS / auth | Oui | `4000 0027 6000 3184` |
| Link | Oui (si activé) | Souvent disponible en Checkout test |
| SEPA Debit | Oui si activé Dashboard | Mandats test Stripe (IBAN test doc Stripe) |
| **Twint** | **Ne pas promettre en test** | Souvent **live-only** / restrictions CH ; activer seulement après validation Stripe Dashboard + tests live contrôlés |

Référence Stripe : [Testing](https://docs.stripe.com/testing).

---

## 5. Checklist lois / règles Suisse (à valider)

À traiter **avant** `STRIPE_LIVE_ENABLED=true` et tout CTA public :

- [ ] Compte Stripe **Business CH** + IBAN payouts vérifié
- [ ] KYC Stripe complet (ID ; extrait RC si société / raison individuelle selon cas)
- [ ] **TVA suisse** : vérifier si inscription TVA obligatoire (seuil de CA / activité). Stripe Tax est **optionnel** ; le calcul / taux / mention facture = **fiduciaire**
- [ ] Mentions légales + **CGV** de vente d’abonnement logiciel (prix, durée, résiliation, support)
- [ ] Droit de **rétractation** / renonciation : règles CH et, si clients **B2C UE**, obligations éventuelles (à faire valider — pas de conseil définitif ici)
- [ ] Politique de confidentialité / traitement des données de paiement (Stripe = sous-traitant PCI)
- [ ] Devises affichées (CHF recommandé pour clients CH) + factures / reçus Stripe
- [ ] Processus de remboursement / litiges (Stripe Radar / chargebacks)

**Rappel :** rien ci-dessus ne remplace un avis professionnel. Valider avec fiduciaire / avocat.

---

## 6. Pourquoi le frontend n’est pas branché + activation

- Exigence produit : backend d’abord, pas d’encaissement UI tant que secrets / CGV / TVA ne sont pas prêts.
- Flags :
  - Edge : `PAYMENTS_ENABLED=false` (défaut) → checkout/portal répondent `503 PAYMENTS_DISABLED`
  - UI : `VITE_PAYMENTS_ENABLED=false` → `crimson/src/lib/payments.ts` refuse les appels ; `SettingsTab` n’affiche pas de boutons payants

**Activer plus tard :**

1. Migration appliquée + functions déployées + secrets test OK  
2. `PAYMENTS_ENABLED=true` (secrets Supabase)  
3. Tester Checkout + webhook + `is_premium`  
4. Checklist CH cochée → éventuellement live + `STRIPE_LIVE_ENABLED=true`  
5. `VITE_PAYMENTS_ENABLED=true` + brancher les boutons (helpers déjà dans `payments.ts`)  
6. Après retour Checkout : `refreshPremium()` (déjà dans AuthContext)

---

## 7. Tests automatisés

```bash
# Mapping price → Premium + mock signature webhook
cargo test -p crimson-server --lib payments::

# Logique Deno partagée (si Deno installé)
deno test --allow-env supabase/functions/_tests/payments_test.ts
```

---

## Secrets (rappel)

Ne **jamais** committer `sk_live_`, `sk_test_` réels, `whsec_`, service_role. Uniquement les `.env.example`.
