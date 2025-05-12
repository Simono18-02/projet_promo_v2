#!/usr/bin/env python3
import os
import json
import requests
from datetime import datetime, timezone
import time

# --- Configuration Constants ---
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
CONFIG_FILE_PATH = os.path.join(SCRIPT_DIR, 'config', 'sensors.json')  # Chemin simplifié
OUTPUT_FILE_PATH = os.path.join(SCRIPT_DIR, 'data.json')  # Sortie à la racine du projet
SENSOR_ENDPOINT = "/readings"
SENSOR_PORT = int(os.environ.get('ESP32_PORT', 5000))  # Utiliser une variable d'environnement ou valeur par défaut
REQUEST_TIMEOUT = int(os.environ.get('SENSOR_TIMEOUT', 5))  # Secondes avant d'abandonner la requête
HISTORY_LIMIT = 144  # Nombre max d'entrées dans l'historique (144 * 10mn = 24h)

# --- Fonctions Utilitaires ---

def load_config(config_path):
    """Charge la configuration des capteurs depuis un fichier JSON."""
    if not os.path.exists(config_path):
        print(f"[ERREUR] Fichier de configuration introuvable: {config_path}")
        # Plutôt que None, retourner un dictionnaire vide pour éviter des erreurs plus loin
        return {}
    try:
        with open(config_path, 'r') as f:
            config = json.load(f)
            print(f"[INFO] Configuration chargée depuis {config_path}")
            return config
    except json.JSONDecodeError as e:
        print(f"[ERREUR] Fichier de configuration JSON invalide: {config_path} - {e}")
        return {}
    except IOError as e:
        print(f"[ERREUR] Impossible de lire le fichier de configuration: {config_path} - {e}")
        return {}

def load_existing_data(output_path):
    """Charge les données existantes depuis le fichier data.json."""
    if not os.path.exists(output_path):
        print(f"[INFO] Fichier de données {output_path} inexistant. Création d'une nouvelle structure.")
        # Retourne la structure de base si le fichier n'existe pas
        return {"lastUpdateTimestamp": None, "sensors": {}}
    try:
        with open(output_path, 'r') as f:
            data = json.load(f)
            # Valider la structure minimale attendue
            if not isinstance(data.get("sensors"), dict):
                print(f"[AVERTISSEMENT] Structure 'sensors' invalide dans {output_path}. Réinitialisation.")
                return {"lastUpdateTimestamp": None, "sensors": {}}
            print(f"[INFO] Données existantes chargées depuis {output_path}")
            return data
    except json.JSONDecodeError as e:
        print(f"[ERREUR] Fichier de données JSON invalide: {output_path} - {e}. Réinitialisation.")
        return {"lastUpdateTimestamp": None, "sensors": {}}  # Reset en cas d'erreur
    except IOError as e:
        print(f"[ERREUR] Impossible de lire le fichier de données: {output_path} - {e}. Réinitialisation.")
        return {"lastUpdateTimestamp": None, "sensors": {}}

def fetch_sensor_data(sensor_id, sensor_config):
    """Tente de récupérer les données d'un seul capteur."""
    ip = sensor_config.get("ip")
    if not ip:
        print(f"[AVERTISSEMENT] IP manquante pour le capteur {sensor_id}. Ignoré.")
        return {"status": "error", "message": "IP manquante"}

    # Construction de l'URL avec le port
    target_url = f"http://{ip}:{SENSOR_PORT}{SENSOR_ENDPOINT}"
    print(f"[INFO] Tentative de fetch pour {sensor_id} sur {target_url}...")

    try:
        response = requests.get(target_url, timeout=REQUEST_TIMEOUT)
        response.raise_for_status()  # Lève une exception pour les status 4xx/5xx

        # Tenter de parser la réponse JSON
        try:
            data = response.json()
            # Vérifier que les clés attendues sont présentes
            if "co2" in data and "tvoc" in data:
                print(f"[SUCCES] Données reçues de {sensor_id}: {data}")
                return {"status": "online", "data": data}
            else:
                print(f"[ERREUR] Réponse JSON invalide de {sensor_id} (clés manquantes): {data}")
                return {"status": "error", "message": "Réponse JSON invalide"}
        except json.JSONDecodeError:
            print(f"[ERREUR] Réponse non-JSON reçue de {sensor_id}: {response.text[:100]}...")  # Log début réponse
            return {"status": "error", "message": "Réponse non-JSON"}

    except requests.exceptions.Timeout:
        print(f"[ERREUR] Timeout en contactant {sensor_id} ({target_url})")
        return {"status": "offline", "message": "Timeout"}
    except requests.exceptions.ConnectionError:
        print(f"[ERREUR] Echec de connexion à {sensor_id} ({target_url})")
        return {"status": "offline", "message": "Echec connexion"}
    except requests.exceptions.RequestException as e:
        print(f"[ERREUR] Erreur de requête pour {sensor_id} ({target_url}): {e}")
        # Le status HTTP (ex: 503 offline du simulateur) est géré par raise_for_status()
        if hasattr(e, 'response') and e.response is not None:
            if e.response.status_code == 503:  # Spécifique pour le simulateur offline
                return {"status": "offline", "message": f"Service Unavailable (Probablement simulé offline)"}
        return {"status": "error", "message": str(e)}  # Autre erreur de requête

def update_data_file(existing_data, fetch_results, sensor_config_all):
    """Met à jour la structure de données avec les nouveaux résultats et l'historique."""

    now_utc = datetime.now(timezone.utc)
    now_iso = now_utc.isoformat()

    # Copie pour éviter de modifier l'original directement si la sauvegarde échoue
    new_data = json.loads(json.dumps(existing_data))  # Deep copy simple
    new_data["lastUpdateTimestamp"] = now_iso

    # Assurer que la clé sensors existe
    if "sensors" not in new_data:
        new_data["sensors"] = {}

    updated_ids = set()

    # Traiter les résultats des capteurs fetchés
    for sensor_id, result in fetch_results.items():
        updated_ids.add(sensor_id)
        sensor_info_from_config = sensor_config_all.get(sensor_id, {})

        # Initialiser l'entrée du capteur si elle n'existe pas
        if sensor_id not in new_data["sensors"]:
            new_data["sensors"][sensor_id] = {
                "name": sensor_info_from_config.get("name", sensor_id),
                "location": sensor_info_from_config.get("location", {}),
                "status": "unknown",  # Statut initial
                "lastReading": None,
                "history": []
            }

        sensor_entry = new_data["sensors"][sensor_id]

        # Mettre à jour le nom et la localisation au cas où ils auraient changé dans la config
        sensor_entry["name"] = sensor_info_from_config.get("name", sensor_id)
        sensor_entry["location"] = sensor_info_from_config.get("location", {})

        if result["status"] == "online":
            sensor_entry["status"] = "online"
            # Créer la nouvelle lecture avec timestamp
            new_reading = {
                "timestamp": now_iso,
                "co2": result["data"].get("co2"),
                "tvoc": result["data"].get("tvoc")
            }
            sensor_entry["lastReading"] = new_reading
            # Ajouter à l'historique (au début) et limiter
            sensor_entry["history"].insert(0, new_reading)
            sensor_entry["history"] = sensor_entry["history"][:HISTORY_LIMIT]

        elif result["status"] == "offline":
            # Si le fetch a explicitement indiqué "offline" (timeout, connexion refusée...)
            sensor_entry["status"] = "offline"
            # Ne pas modifier lastReading, ne pas ajouter à l'historique
            print(f"[INFO] Capteur {sensor_id} marqué comme offline.")

        elif result["status"] == "error":
            # Si une erreur imprévue (JSON invalide, erreur requête non gérée spécifiquement)
            # On peut choisir de le mettre offline ou garder le statut précédent
            # On va le mettre offline pour indiquer un problème
            print(f"[AVERTISSEMENT] Erreur lors du fetch pour {sensor_id}. Marqué offline.")
            sensor_entry["status"] = "offline"
            # Ne pas modifier lastReading, ne pas ajouter à l'historique

    # Écrire les données mises à jour dans le fichier de sortie
    try:
        # Créer le répertoire parent si nécessaire
        os.makedirs(os.path.dirname(OUTPUT_FILE_PATH), exist_ok=True)
        
        with open(OUTPUT_FILE_PATH, 'w') as f:
            json.dump(new_data, f, indent=2, ensure_ascii=False)
        print(f"[SUCCES] Fichier de données mis à jour : {OUTPUT_FILE_PATH}")
    except IOError as e:
        print(f"[ERREUR CRITIQUE] Impossible d'écrire dans le fichier de données: {OUTPUT_FILE_PATH} - {e}")
    except Exception as e:
        print(f"[ERREUR CRITIQUE] Erreur inattendue lors de l'écriture JSON : {e}")


# --- Fonction Principale ---

def main():
    """Point d'entrée du script."""
    print(f"--- Lancement du script de mise à jour des données capteurs ({datetime.now()}) ---")

    # 1. Charger la configuration
    sensor_config = load_config(CONFIG_FILE_PATH)
    if not sensor_config:
        print("[AVERTISSEMENT] Configuration vide ou en erreur. Aucun capteur à interroger.")
        # On continue avec une config vide plutôt que d'arrêter
    
    # 2. Charger les données existantes
    existing_data = load_existing_data(OUTPUT_FILE_PATH)

    # 3. Fetch les données de chaque capteur configuré
    current_fetch_results = {}
    if isinstance(sensor_config, dict):
        for sensor_id, config_details in sensor_config.items():
            fetch_result = fetch_sensor_data(sensor_id, config_details)
            current_fetch_results[sensor_id] = fetch_result
    else:
        print("[ERREUR] Le format de la configuration n'est pas un dictionnaire attendu.")
        # On continue avec un dictionnaire vide plutôt que d'arrêter
        current_fetch_results = {}

    # 4. Mettre à jour la structure de données globale et sauvegarder
    update_data_file(existing_data, current_fetch_results, sensor_config)

    print(f"--- Fin du script ({datetime.now()}) ---")

# --- Exécution ---
if __name__ == "__main__":
    main()
