#!/usr/bin/env python3
import json
import random
import time
from flask import Flask, jsonify, request
from threading import Thread, Lock
import os

# --- Simulation Parameters ---
# Lire la configuration des capteurs pour savoir quels IPs simuler
CONFIG_FILE_PATH = os.path.join(os.path.dirname(__file__), '..', 'config', 'sensors.json') # Ajuster le chemin si nécessaire

# Probabilité qu'un capteur soit "offline" (ex: 0.1 = 10% de chance)
OFFLINE_PROBABILITY = 0.05

# Comportement des valeurs simulées
CO2_BASE = 450  # Baseline minimum
CO2_RANGE = 800 # Max addition aléatoire (450 à 1250 ppm)
TVOC_BASE = 5   # Baseline minimum ppb
TVOC_RANGE = 250 # Max addition aléatoire (5 à 255 ppb)

# --- Global State for Simulated Sensors ---
simulated_sensors = {} # Dictionnaire: { "ip_address:port": {"co2": value, "tvoc": value, "status": "online/offline"}}
sensor_lock = Lock() # Pour gérer l'accès concurrentiel au dictionnaire

# --- Flask App Initialization ---
app = Flask(__name__)

# --- Function to load sensor IPs from config ---
def load_sensor_config():
    """Charge la config et initialise les capteurs simulés."""
    global simulated_sensors
    if not os.path.exists(CONFIG_FILE_PATH):
        print(f"ERREUR: Fichier de configuration introuvable: {CONFIG_FILE_PATH}")
        return {}

    try:
        with open(CONFIG_FILE_PATH, 'r') as f:
            config = json.load(f)
    except Exception as e:
        print(f"Erreur de lecture du fichier config: {e}")
        return {}

    initial_sensors = {}
    sensor_ips = set() # Pour détecter les IPs dupliquées

    for sensor_id, details in config.items():
        ip = details.get('ip')
        if not ip:
            print(f"AVERTISSEMENT: IP manquante pour le capteur {sensor_id}")
            continue

        if ip in sensor_ips:
             print(f"AVERTISSEMENT: IP dupliquée détectée ({ip}) pour {sensor_id}. Sera gérée par le même simulateur.")
        sensor_ips.add(ip)

        # Initialise l'état du capteur
        initial_sensors[ip] = {
            "co2": CO2_BASE + random.randint(0, CO2_RANGE // 2), # Start un peu plus bas
            "tvoc": TVOC_BASE + random.randint(0, TVOC_RANGE // 2),
            "status": "online"
        }
    print(f"Configuration chargée. Simulation des IPs: {list(sensor_ips)}")
    return initial_sensors, list(sensor_ips)


# --- Function to Update Simulated Sensor Values Periodically ---
def update_simulation():
    """Met à jour les valeurs CO2/TVOC et le statut online/offline."""
    global simulated_sensors
    print("Thread de simulation démarré. Mise à jour toutes les 5 secondes.")
    while True:
        with sensor_lock:
            for ip in simulated_sensors:
                # Simuler le statut online/offline
                if random.random() < OFFLINE_PROBABILITY:
                    simulated_sensors[ip]["status"] = "offline"
                    print(f"DEBUG SIM: Capteur {ip} -> OFFLINE")
                else:
                    simulated_sensors[ip]["status"] = "online"
                    # Simuler la variation des données seulement si online
                    # Rendre les variations un peu plus fluides
                    delta_co2 = random.randint(-50, 70) # Peut monter plus facilement que descendre
                    delta_tvoc = random.randint(-15, 25)

                    current_co2 = simulated_sensors[ip]["co2"]
                    current_tvoc = simulated_sensors[ip]["tvoc"]

                    simulated_sensors[ip]["co2"] = max(CO2_BASE, min(CO2_BASE + CO2_RANGE, current_co2 + delta_co2))
                    simulated_sensors[ip]["tvoc"] = max(TVOC_BASE, min(TVOC_BASE + TVOC_RANGE, current_tvoc + delta_tvoc))
                    # print(f"DEBUG SIM: Capteur {ip} -> ONLINE (CO2: {simulated_sensors[ip]['co2']}, TVOC: {simulated_sensors[ip]['tvoc']})") # Trop verbeux

        time.sleep(5) # Mise à jour toutes les 5 secondes

# --- Flask Route to Mimic ESP32 /readings endpoint ---
@app.route('/readings', methods=['GET'])
def get_readings():
    """Simule la réponse d'un ESP32 à l'adresse IP demandée."""
    # Obtenir l'IP du client (celui qui request /readings) - NE MARCHE PAS car flask tourne localement
    # On utilise l'host sur lequel tourne flask pour identifier quel capteur répondre
    host_ip = request.host.split(':')[0] # Récupère l'IP sur laquelle le serveur écoute sur CETTE requête


    with sensor_lock:
        if host_ip not in simulated_sensors:
            # Normalement, Flask ne devrait répondre que sur les IPs bindées,
            # mais au cas où, ou pour des tests avec 127.0.0.1
            first_ip = next(iter(simulated_sensors)) if simulated_sensors else None
            if not first_ip:
                 return jsonify({"error": "Aucun capteur simulé configuré"}), 500
            print(f"AVERTISSEMENT: Requête pour IP {host_ip} non explicitement simulée, réponds comme {first_ip}")
            host_ip = first_ip # Fallback: répondre comme le premier capteur simulé

        sensor_state = simulated_sensors.get(host_ip)

        if not sensor_state: # Double check
             return jsonify({"error": f"État du capteur {host_ip} introuvable"}), 404

        if sensor_state["status"] == "offline":
            # Simuler une erreur (timeout ou refus de connexion se produirait avant dans la vraie vie)
            # Ici on renvoie une erreur 503 Service Unavailable pour être clair
            print(f"SIMULATOR: {host_ip} répond OFFLINE")
            return jsonify({"error": "Sensor offline"}), 503
        else:
             # Renvoyer les valeurs CO2/TVOC simulées
            response_data = {
                "co2": sensor_state["co2"],
                "tvoc": sensor_state["tvoc"]
            }
            print(f"SIMULATOR: {host_ip} répond ONLINE -> {response_data}")
            return jsonify(response_data), 200

@app.route('/')
def index():
     """Page simple pour vérifier que le simulateur tourne."""
     html = "<h1>ESP32 Simulator</h1><p>Ce serveur simule les endpoints /readings des ESP définis dans <code>config/sensors.json</code>.</p>"
     html += "<ul>"
     with sensor_lock:
         for ip, state in simulated_sensors.items():
              html += f"<li>IP: {ip} | Status: {state['status']} | CO2: {state['co2']} | TVOC: {state['tvoc']}</li>"
     html += "</ul>"
     return html

# --- Main Execution ---
if __name__ == '__main__':
    # Charger la config et initialiser les états
    initial_state, simulated_ips = load_sensor_config()
    if not initial_state:
        print("Echec du chargement de la configuration des capteurs. Arrêt.")
        exit(1)

    simulated_sensors = initial_state

    # Démarrer le thread de mise à jour de la simulation en arrière-plan
    simulation_thread = Thread(target=update_simulation, daemon=True)
    simulation_thread.start()

    # Démarrer le serveur Flask
    # Il écoutera sur toutes les interfaces (0.0.0.0) pour potentielles requêtes externes
    # mais il ne répondra correctement qu'aux IPs configurées
    print("\nLancement du serveur Flask de simulation...\n")
    try:
        # Important: Flask ne peut pas écouter spécifiquement sur PLUSIEURS IPs locales arbitraires
        # facilement. Il écoute sur 0.0.0.0 (toutes les interfaces locales) ou une seule IP .
        # Le script `fetch_sensor_data.py` contactera les IPs DÉFINIES dans sensors.json.
        # Ces requêtes arriveront SUR CE serveur Flask qui tourne localement.
        # La logique dans get_readings() détermine la réponse basée sur `request.host`.
        PORT = 5000 # Port standard pour Flask, assurez-vous qu'il est libre
        app.run(host='0.0.0.0', port=PORT, debug=False) # debug=False pour la démo
        # Sur Windows, '0.0.0.0' devrait fonctionner. Si problème, essayez l'IP locale spécifique de votre machine.
    except OSError as e:
         print(f"\nERREUR: Impossible de démarrer le serveur sur le port {PORT}. Le port est-il déjà utilisé ?")
         print(f"Erreur détaillée: {e}")
    except Exception as e:
        print(f"\nUne erreur inattendue est survenue: {e}")