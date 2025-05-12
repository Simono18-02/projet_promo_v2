// map.js

// --- Configuration ---
// REMPLACEZ par votre URL réelle de data.json sur GitHub Raw
const DATA_URL = 'https://raw.githubusercontent.com/Simono18-02/Projet-de-promo/main/data.json';
// REMPLACEZ par le chemin de votre image de plan
const MAP_IMAGE_URL = 'plan.png';
// REMPLACEZ par les dimensions réelles (largeur, hauteur) de votre image plan.png en pixels
const MAP_IMAGE_WIDTH = 1366; // Exemple
const MAP_IMAGE_HEIGHT = 768; // Exemple

// Seuils de qualité d'air (exemple, ajustez si nécessaire)
const QUALITY_THRESHOLDS = {
    co2: { good: 800, moderate: 1000 }, // ppm
    tvoc: { good: 100, moderate: 150 } // ppb
};

// Délai de rafraîchissement des données (en millisecondes)
const REFRESH_INTERVAL = 60000; // 1 minute

// --- Éléments DOM ---
const loadingMessage = document.getElementById('loading-message');
const errorMessage = document.getElementById('error-message');
const mapElement = document.getElementById('map');

// --- Initialisation Leaflet ---
let map = null;
let imageOverlay = null;
let sensorMarkers = {}; // Pour garder une référence aux marqueurs

// Fonction pour déterminer le niveau de qualité
function getQualityLevel(co2, tvoc) {
    if (co2 === null || tvoc === null) return 'unknown'; // Si données manquantes
    if (co2 > QUALITY_THRESHOLDS.co2.moderate || tvoc > QUALITY_THRESHOLDS.tvoc.moderate) {
        return 'poor';
    } else if (co2 > QUALITY_THRESHOLDS.co2.good || tvoc > QUALITY_THRESHOLDS.tvoc.good) {
        return 'moderate';
    } else {
        return 'good';
    }
}

// Fonction pour obtenir la classe CSS de couleur
function getQualityColorClass(status, qualityLevel) {
    if (status === 'offline') return 'quality-offline';
    if (status === 'unknown' || qualityLevel === 'unknown') return 'quality-unknown';
    return `quality-${qualityLevel}`;
}

// Fonction pour créer ou mettre à jour les marqueurs
function updateMarkers(sensorData) {
    if (!map) return; // S'assurer que la carte est initialisée

    const sensors = sensorData.sensors || {};

    for (const sensorId in sensors) {
        const sensor = sensors[sensorId];
        const { name, location, status, lastReading } = sensor;

        // Vérifier si les coordonnées existent
        if (!location || location.x === undefined || location.y === undefined) {
            console.warn(`Coordonnées manquantes pour le capteur ${sensorId}`);
            continue; // Passer au capteur suivant
        }

        // Coordonnées pour CRS.Simple : Y est inversé par rapport au placement d'image classique
        // Et on suppose que (0,0) est en haut à gauche de l'image.
        // Leaflet CRS.Simple a (0,0) en bas à gauche.
        const latLng = map.unproject([location.x, location.y], map.getMaxZoom()); // Convertir pixel xy en LatLng Leaflet interne

        let qualityLevel = 'unknown';
        let co2Value = '--';
        let tvocValue = '--';
        let timestamp = 'N/A';

        if (status === 'online' && lastReading) {
            co2Value = lastReading.co2 !== null ? lastReading.co2 : '--';
            tvocValue = lastReading.tvoc !== null ? lastReading.tvoc : '--';
            qualityLevel = getQualityLevel(lastReading.co2, lastReading.tvoc);
            timestamp = lastReading.timestamp ? new Date(lastReading.timestamp).toLocaleString('fr-FR') : 'N/A';
        } else if (status === 'offline') {
             qualityLevel = 'offline';
        }

         const colorClass = getQualityColorClass(status, qualityLevel);

        // Contenu du popup
        const popupContent = `
            <div class="font-sans p-1">
                <strong class="text-lg block mb-1 text-enise-blue dark:text-blue-300">${name || sensorId}</strong>
                <div class="text-sm text-gray-700 dark:text-gray-300">
                    Statut: <span class="font-semibold">${status}</span><br>
                    CO2: <span class="font-semibold">${co2Value} ppm</span><br>
                    TVOC: <span class="font-semibold">${tvocValue} ppb</span><br>
                    Dernière lecture: ${timestamp}<br>
                    <a href="dashboard.html?sensor=${sensorId}" class="text-blue-600 dark:text-blue-400 hover:underline mt-1 inline-block">Voir historique</a>
                </div>
            </div>
        `;


        if (sensorMarkers[sensorId]) {
            // Mettre à jour le marqueur existant
            sensorMarkers[sensorId].setLatLng(latLng);
            sensorMarkers[sensorId].setPopupContent(popupContent);
             // Mise à jour du style (couleur) - nécessite un moyen d'appliquer la classe
             // La méthode simple est d'utiliser L.divIcon ou reconstruire L.circleMarker si L.circleMarker n'expose pas son élément facilement
             // Alternative plus simple : utiliser un L.Circle avec une couleur de remplissage

              // Pour L.circleMarker, mettons à jour les options de style
              let fillColor;
              switch (colorClass) {
                    case 'quality-good': fillColor = '#28a745'; break;
                    case 'quality-moderate': fillColor = '#ffc107'; break;
                    case 'quality-poor': fillColor = '#dc3545'; break;
                    case 'quality-offline': fillColor = '#6c757d'; break;
                    default: fillColor = '#adb5bd';
              }
              sensorMarkers[sensorId].setStyle({
                    fillColor: fillColor,
                    fillOpacity: 0.8,
                    color: '#ffffff', // Couleur de la bordure
                    weight: 2
              });


        } else {
            // Créer un nouveau marqueur (cercle)
            let fillColor;
            switch (colorClass) {
                    case 'quality-good': fillColor = '#28a745'; break;
                    case 'quality-moderate': fillColor = '#ffc107'; break;
                    case 'quality-poor': fillColor = '#dc3545'; break;
                    case 'quality-offline': fillColor = '#6c757d'; break;
                    default: fillColor = '#adb5bd';
            }

            const marker = L.circleMarker(latLng, {
                radius: 8,       // Taille du cercle
                fillColor: fillColor,
                fillOpacity: 0.8,
                color: '#ffffff', // Couleur de la bordure
                weight: 2       // Epaisseur de la bordure
            }).addTo(map);

            marker.bindPopup(popupContent);
            sensorMarkers[sensorId] = marker;
        }
    }

     // Supprimer les marqueurs pour les capteurs qui n'existent plus (peu probable mais propre)
     for (const existingId in sensorMarkers) {
         if (!sensors[existingId]) {
             map.removeLayer(sensorMarkers[existingId]);
             delete sensorMarkers[existingId];
         }
     }
}


// Fonction principale pour initialiser la carte et charger les données
async function initializeMap() {
    try {
        // --- Initialisation de la carte Leaflet avec CRS.Simple ---
        map = L.map('map', {
            crs: L.CRS.Simple, // Utiliser un système de coordonnées simple
            minZoom: -1, // Autoriser le dézoom pour voir toute l'image
             maxZoom: 2  // Limiter le zoom avant si besoin
        });

        // Définir les limites de la carte basées sur les dimensions de l'image
        const bounds = [[0, 0], [MAP_IMAGE_HEIGHT, MAP_IMAGE_WIDTH]]; // [[minY, minX], [maxY, maxX]]

        // Ajouter l'image du plan comme une surcouche
        imageOverlay = L.imageOverlay(MAP_IMAGE_URL, bounds).addTo(map);

        // Ajuster la vue pour afficher l'ensemble de l'image
        map.fitBounds(bounds);

        // Afficher la carte et masquer le message de chargement
        mapElement.style.display = 'block';
        loadingMessage.style.display = 'none';
        errorMessage.style.display = 'none';

        // Charger les données initiales
        await loadAndDisplayData();

        // Configurer le rafraîchissement automatique
        setInterval(loadAndDisplayData, REFRESH_INTERVAL);

    } catch (error) {
          console.error("Erreur lors de l'initialisation de la carte:", error);
          mapElement.style.display = 'none';
          loadingMessage.style.display = 'none';
          errorMessage.textContent = `Erreur lors du chargement de la carte ou de l'image du plan: ${error.message}`;
          errorMessage.style.display = 'block';
    }
}

async function loadAndDisplayData() {
     console.log("Chargement des données des capteurs...");
     try {
        const response = await fetch(DATA_URL, { cache: 'no-store' }); // Eviter le cache
        if (!response.ok) {
            throw new Error(`Erreur HTTP ${response.status}: ${response.statusText}`);
        }
        const data = await response.json();

        if (!data || !data.sensors ) {
             throw new Error("Format de données invalide ou données manquantes.");
        }

        updateMarkers(data);
        console.log("Marqueurs mis à jour.");
        errorMessage.style.display = 'none'; // Cacher message d'erreur si succès

    } catch (error) {
        console.error("Erreur lors du chargement ou de la mise à jour des données:", error);
        // Afficher une erreur mais ne pas masquer la carte si elle est déjà visible
        errorMessage.textContent = `Erreur de chargement des données: ${error.message}. Tentative de rafraîchissement dans ${REFRESH_INTERVAL / 1000}s.`;
        errorMessage.style.display = 'block';
        // On pourrait aussi mettre les marqueurs dans un état "erreur" ou "inconnu"
         // Par exemple, mettre tous les capteurs en état 'unknown'
         const emptyData = { sensors: {} }
         for(const id in sensorMarkers) { emptyData.sensors[id] = { status: 'unknown', location: sensorMarkers[id].getLatLng() } } // Simplifié

         // Ne pas crasher la page, juste indiquer l'erreur et essayer de nouveau plus tard.
    }
}

// Lancer l'initialisation lorsque le DOM est prêt
document.addEventListener('DOMContentLoaded', initializeMap);