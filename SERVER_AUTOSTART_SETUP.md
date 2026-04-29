# Configuration du Démarrage Automatique du Serveur Crimson

## Résumé des Changements

Le système d'autostart du serveur Crimson a été amélioré pour être beaucoup plus robuste :

### 1. **Windows Task Scheduler** (Au lieu de Registry)
- ✅ Plus fiable que les clés registry
- ✅ Gestion centralisée via Windows Task Manager
- ✅ Meilleure intégration avec le système d'exploitation
- ✅ Logs disponibles dans l'Event Viewer

### 2. **Meilleure Recherche du Serveur** (`find_server_path`)
Recherche maintenant dans cet ordre de priorité :
1. Répertoire de ressources Tauri (bundled avec l'app)
2. Répertoire exécutable de l'app
3. Répertoires de build (cargo-target-hotfix2/release, etc.)
4. Répertoires de développement locaux
5. Répertoires d'installation Crimson standards
6. Recherche récursive dans les répertoires parent

### 3. **Nouvelle Commande de Diagnostic**
`crimson_get_server_autostart_info` retourne :
- Statut d'activation
- Chemin du serveur trouvé
- Existence de la tâche Task Scheduler
- Erreurs détectées

## Comment Utiliser

### Activation de l'Autostart

1. Ouvrez l'application Crimson
2. Allez dans Settings > Server
3. Activez "Lancer le serveur au démarrage"
4. Une tâche Windows Task Scheduler nommée "CrimsonServer" sera créée

### Vérification de la Configuration

Pour vérifier que tout fonctionne correctement :

```powershell
# Vérifier que la tâche existe
Get-ScheduledTask -TaskName "CrimsonServer" -ErrorAction SilentlyContinue

# Voir l'état de la tâche
Get-ScheduledTask -TaskName "CrimsonServer" | Select-Object -Property State, LastRunTime

# Voir les logs d'exécution
Get-EventLog -LogName "System" -Source "Task Scheduler" -Newest 10
```

### Désactivation de l'Autostart

1. Ouvrez l'application Crimson
2. Allez dans Settings > Server
3. Désactivez "Lancer le serveur au démarrage"
4. La tâche Task Scheduler sera supprimée

## Dépannage

### Le serveur ne démarre pas au boot

**Vérifier les points suivants :**

1. **La tâche Task Scheduler existe-t-elle ?**
   ```powershell
   Get-ScheduledTask -TaskName "CrimsonServer"
   ```

2. **Le serveur exécutable est-il trouvé ?**
   - Vérifier dans les logs de debug de Crimson
   - Le chemin doit être absolu et valide

3. **Les permissions sont-elles correctes ?**
   - La tâche s'exécute avec les droits de votre utilisateur
   - Si vous êtes en mode sans-admin, vérifier les permissions de fichier

4. **Windows Event Viewer**
   - Aller à Windows Logs > System > Task Scheduler
   - Chercher les événements "CrimsonServer"

### Chemin du serveur incorrect

Si le système ne trouve pas le serveur :
1. Assurez-vous que Crimson est correctement compilé/installé
2. Vérifiez le répertoire d'installation : `C:\Users\[USERNAME]\AppData\Local\crimson\`
3. Le binaire devrait être nommé `crimson-server.exe`

### Réinitialiser la configuration

Pour réinitialiser complètement :

1. **Supprimer la tâche Task Scheduler :**
   ```powershell
   Unregister-ScheduledTask -TaskName "CrimsonServer" -Confirm:$false
   ```

2. **Réactiver depuis Crimson Settings**

## Architecture Technique

### Flux de Démarrage Automatique

```
Windows Boot
    ↓
User Logon
    ↓
Task Scheduler: "CrimsonServer" trigger
    ↓
crimson-server.exe lance
    ↓
Détection d'instance primaire (port 40510)
    ↓
Initialisation des services (Spotify, Discord, LCU, etc.)
    ↓
WebSocket server démarre sur 127.0.0.1:40510
    ↓
Plugins (StreamDeck) peuvent se connecter
```

### Avantages de cette Approche

1. **Pas dépendant de Crimson UI** - Le serveur se lance même si Crimson Desktop n'est pas ouvert
2. **Persist à travers les redémarrages** - Configuré au niveau système
3. **Gestion des ressources** - Runs as detached process
4. **Logging** - Event Viewer logs disponibles pour le diagnostic
5. **Facilement désactivable** - Via Settings ou Task Scheduler

## Fichiers Modifiés

- `apps/desktop/src-tauri/src/commands.rs`:
  - `crimson_toggle_server_autostart()` - Utilise Task Scheduler
  - `find_server_path()` - Amélioration de la recherche
  - `create_server_scheduled_task()` - Nouvelle fonction
  - `remove_server_scheduled_task()` - Nouvelle fonction
  - `crimson_get_server_autostart_info()` - Nouvelle fonction de diagnostic

- `apps/desktop/src-tauri/src/lib.rs`:
  - Ajout de `crimson_get_server_autostart_info` au handler

## Notes Importantes

⚠️ **Pour que cela fonctionne correctement :**
- La compilation Rust du serveur doit être à jour
- L'exécutable `crimson-server.exe` doit exister et être exécutable
- Windows doit permettre l'exécution des scripts PowerShell (vérifier ExecutionPolicy)
- L'utilisateur doit avoir les droits d'accès en lecture aux fichiers du serveur
