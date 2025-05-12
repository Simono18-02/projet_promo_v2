// dashboard.js

// --- Configuration ---
// REMPLACEZ par votre URL réelle de data.json sur GitHub Raw
const DATA_URL = 'https://raw.githubusercontent.com/Simono18-02/Projet-de-promo/main/data.json';

// Seuils de qualité d'air (dupliqué de map.js, idéalement dans un fichier commun)
const QUALITY_THRESHOLDS = {
    co2: { good: 800, moderate: 1000 }, // ppm
    tvoc: { good: 100, moderate: 150 } // ppb
};

// Délai de rafraîchissement des données pour le tableau de bord (plus fréquent?)
const REFRESH_INTERVAL = 30000; // 30 secondes

// --- Éléments DOM ---
const sensorSelect = document.getElementById('sensor-select');
const loadingMessage = document.getElementById('loading-message');
const errorMessage = document.getElementById('error-message');
const detailsSection = document.getElementById('sensor-details');
const chartsSection = document.getElementById('charts-section');
const detailsName = document.getElementById('details-name');
const detailsStatus = document.getElementById('details-status');
const detailsTimestamp = document.getElementById('details-timestamp');
const detailsCo2 = document.getElementById('details-co2');
const detailsTvoc = document.getElementById('details-tvoc');
const detailsQualityIndicator = document.getElementById('details-quality-indicator');
const co2ChartCtx = document.getElementById('co2Chart').getContext('2d');
const tvocChartCtx = document.getElementById('tvocChart').getContext('2d');

// --- Variables globales ---
let co2Chart = null;
let tvocChart = null;
let lastSensorData = null; // Pour stocker les dernières données fetchées
let refreshIntervalId = null;

// --- Fonctions Utilitaires (qualité - dupliquées de map.js) ---
function getQualityLevel(co2, tvoc) {
     if (co2 === null || tvoc === null) return 'unknown';
     if (co2 > QUALITY_THRESHOLDS.co2.moderate || tvoc > QUALITY_THRESHOLDS.tvoc.moderate) {
        return 'poor';
    } else if (co2 > QUALITY_THRESHOLDS.co2.good || tvoc > QUALITY_THRESHOLDS.tvoc.good) {
        return 'moderate';
    } else {
        return 'good';
    }
}

function getQualityColorClass(status, qualityLevel) {
    if (status === 'offline') return 'quality-offline';
    if (status === 'unknown' || qualityLevel === 'unknown') return 'quality-unknown';
    return `quality-${qualityLevel}`;
}

function getQualityText(status, qualityLevel) {
    if (status === 'offline') return 'Hors ligne';
    if (status === 'unknown' || qualityLevel === 'unknown') return 'Inconnu';
    switch (qualityLevel) {
        case 'good': return 'Bon';
        case 'moderate': return 'Modéré';
        case 'poor': return 'Dégradé';
        default: return '?';
    }
}

// --- Fonctions Chart.js ---
function createChart(ctx, label) {
    return new Chart(ctx, {
        type: 'line',
        data: {
            labels: [], // Sera rempli par les timestamps
            datasets: [{
                label: label,
                data: [], // Sera rempli par les valeurs
                borderColor: label === 'CO2' ? 'rgb(54, 162, 235)' : 'rgb(255, 159, 64)', // Blue pour CO2, Orange pour TVOC
                backgroundColor: label === 'CO2' ? 'rgba(54, 162, 235, 0.2)' : 'rgba(255, 159, 64, 0.2)',
                tension: 0.1, // Ligne légèrement courbée
                fill: true, // Remplir la zone sous la courbe
                pointRadius: 2, // Taille des points
                pointHoverRadius: 5 // Taille au survol
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: {
                    type: 'time', // Utiliser l'axe temporel
                    time: {
                         unit: 'hour', // Adapter dynamiquement ? ex: 'minute', 'day'
                         tooltipFormat: 'dd/MM/yyyy HH:mm', // Format du tooltip
                         displayFormats: {
                             //hour: 'HH:mm' // Format d'affichage sur l'axe
                             hour: 'HH:mm', // Format d'affichage pour les heures
                             minute: 'HH:mm', // Format d'affichage pour les minutes
                             day: 'dd/MM' // Format pour les jours
                         }
                    },
                    title: {
                        display: true,
                        text: 'Temps'
                    },
                     ticks: {
                         color: document.documentElement.classList.contains('dark') ? '#e5e7eb' : '#4b5563', // Gris clair en dark, gris foncé en light
                     },
                     grid: {
                         color: document.documentElement.classList.contains('dark') ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)',
                     }
                },
                y: {
                    beginAtZero: false, // Ne pas forcément commencer à 0
                    title: {
                        display: true,
                        text: label === 'CO2' ? 'ppm' : 'ppb'
                    },
                    ticks: {
                         color: document.documentElement.classList.contains('dark') ? '#e5e7eb' : '#4b5563',
                     },
                     grid: {
                          color: document.documentElement.classList.contains('dark') ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)',
                     }
                }
            },
            plugins: {
                 legend: {
                     display: false // On a déjà le titre du graphique
                 },
                 tooltip: {
                     mode: 'index',
                     intersect: false,
                 }
             },
              interaction: { // Améliore l'interaction sur mobile
                 mode: 'nearest',
                 axis: 'x',
                 intersect: false
             }
        }
    });
}

// Fonction pour mettre à jour les graphiques et les détails
function updateDashboard(selectedSensorId) {
    if (!lastSensorData || !lastSensorData.sensors || !lastSensorData.sensors[selectedSensorId]) {
        // Si le capteur sélectionné n'existe pas dans les données (ou données pas chargées)
        detailsSection.classList.add('hidden');
        chartsSection.classList.add('hidden');
        errorMessage.textContent = "Données non disponibles pour ce capteur.";
        errorMessage.style.display = 'block';
        return;
    }

    errorMessage.style.display = 'none'; // Cacher l'erreur si on a des données

    const sensor = lastSensorData.sensors[selectedSensorId];
    const { name, status, lastReading, history } = sensor;

    // Mettre à jour les détails
    detailsName.textContent = name || selectedSensorId;
    detailsStatus.textContent = status;
    let qualityLevel = 'unknown';
    let co2Value = '--';
    let tvocValue = '--';
    let timestampText = 'N/A';

    // Définir la couleur du statut
    detailsStatus.classList.remove('text-green-600', 'text-yellow-600', 'text-red-600', 'text-gray-500');
    detailsStatus.classList.remove('dark:text-green-400', 'dark:text-yellow-400', 'dark:text-red-400', 'dark:text-gray-400');

    if (status === 'online' && lastReading) {
         co2Value = lastReading.co2 !== null ? lastReading.co2 : '--';
         tvocValue = lastReading.tvoc !== null ? lastReading.tvoc : '--';
        qualityLevel = getQualityLevel(lastReading.co2, lastReading.tvoc);
        timestampText = lastReading.timestamp ? new Date(lastReading.timestamp).toLocaleString('fr-FR') : 'N/A';

        switch (qualityLevel) {
            case 'good':
                 detailsStatus.classList.add('text-green-600', 'dark:text-green-400'); break;
             case 'moderate':
                 detailsStatus.classList.add('text-yellow-600', 'dark:text-yellow-400'); break;
             case 'poor':
                 detailsStatus.classList.add('text-red-600', 'dark:text-red-400'); break;
             default:
                  detailsStatus.classList.add('text-gray-500', 'dark:text-gray-400');
         }
    } else if(status === 'offline') {
         detailsStatus.textContent = "Hors ligne";
         detailsStatus.classList.add('text-gray-500', 'dark:text-gray-400');
         qualityLevel = 'offline';
    } else {
         detailsStatus.textContent = "Inconnu";
         detailsStatus.classList.add('text-gray-500', 'dark:text-gray-400');
    }


    detailsTimestamp.textContent = timestampText;
    detailsCo2.innerHTML = `${co2Value} <span class="text-lg">ppm</span>`;
    detailsTvoc.innerHTML = `${tvocValue} <span class="text-lg">ppb</span>`;


     // Mise à jour de l'indicateur visuel
     const indicatorColorClass = getQualityColorClass(status, qualityLevel);
     const indicatorText = getQualityText(status, qualityLevel);
     detailsQualityIndicator.className = `w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-sm shadow-inner ${indicatorColorClass}`;
     detailsQualityIndicator.textContent = indicatorText;


    detailsSection.classList.remove('hidden');
    chartsSection.classList.remove('hidden');

    // Mettre à jour les graphiques
    const chartLabels = [];
    const co2DataPoints = [];
    const tvocDataPoints = [];

    // L'historique est supposé être trié du plus récent au plus ancien
    // Inverser pour l'affichage chronologique sur le graphique
    const sortedHistory = history ? [...history].reverse() : [];

    sortedHistory.forEach(reading => {
        // Assurer que timestamp est valide et que les données sont présentes
        if (reading && reading.timestamp && (reading.co2 !== null || reading.tvoc !== null)) {
             chartLabels.push(new Date(reading.timestamp)); // Date object pour l'axe temps
             co2DataPoints.push(reading.co2); // Peut être null
             tvocDataPoints.push(reading.tvoc); // Peut être null
         }
    });

    // Mettre à jour les données des graphiques
    co2Chart.data.labels = chartLabels;
    co2Chart.data.datasets[0].data = co2DataPoints;

    tvocChart.data.labels = chartLabels;
    tvocChart.data.datasets[0].data = tvocDataPoints;

     // Pour l'axe temporel, il peut être nécessaire d'adapter l'unité
    // const timeDiff = chartLabels.length > 1 ? chartLabels[chartLabels.length - 1] - chartLabels[0] : 0;
    // const hoursDiff = timeDiff / (1000 * 60 * 60);
    // let timeUnit = 'hour';
    // if (hoursDiff > 48) { timeUnit = 'day'; }
    // else if (hoursDiff < 2) { timeUnit = 'minute'};
    // co2Chart.options.scales.x.time.unit = timeUnit;
    // tvocChart.options.scales.x.time.unit = timeUnit; // Ajuster l'unité de temps si besoin

    co2Chart.update();
    tvocChart.update();
}

// Fonction pour charger les données et peupler le sélecteur
async function loadInitialData() {
    loadingMessage.textContent = "Chargement des données initiales...";
    loadingMessage.style.display = 'block';
    errorMessage.style.display = 'none';
    sensorSelect.disabled = true;

    try {
        const response = await fetch(DATA_URL, { cache: 'no-store' });
        if (!response.ok) {
             throw new Error(`Erreur HTTP ${response.status}: ${response.statusText}`);
        }
        lastSensorData = await response.json();

        if (!lastSensorData || !lastSensorData.sensors) {
             throw new Error("Format de données invalide ou données manquantes.");
        }

        // Peupler le sélecteur
        sensorSelect.innerHTML = '<option value="">-- Choisir une salle --</option>'; // Reset
        const sensorIds = Object.keys(lastSensorData.sensors).sort(); // Trier par ID

        sensorIds.forEach(id => {
             const sensor = lastSensorData.sensors[id];
             const option = document.createElement('option');
             option.value = id;
             option.textContent = sensor.name || id; // Utiliser le nom si disponible
             sensorSelect.appendChild(option);
         });

         loadingMessage.style.display = 'none';
         sensorSelect.disabled = false;

        // Vérifier si un capteur est spécifié dans l'URL (ex: map.html -> dashboard.html?sensor=Salle_101)
         const urlParams = new URLSearchParams(window.location.search);
         const sensorFromUrl = urlParams.get('sensor');

         if (sensorFromUrl && sensorIds.includes(sensorFromUrl)) {
             sensorSelect.value = sensorFromUrl;
             updateDashboard(sensorFromUrl);
         } else if (sensorIds.length > 0) {
            // Sélectionner le premier capteur par défaut au premier chargement s'il n'y a pas de paramètre URL
             //sensorSelect.value = sensorIds[0]; // Optionnel: Sélectionner le premier par défaut
             //updateDashboard(sensorIds[0]);
              // Ou ne rien sélectionner et laisser l'utilisateur choisir
                detailsSection.classList.add('hidden');
                chartsSection.classList.add('hidden');
         } else {
             errorMessage.textContent = "Aucun capteur trouvé dans les données.";
             errorMessage.style.display = 'block';
             detailsSection.classList.add('hidden');
             chartsSection.classList.add('hidden');
         }


    } catch (error) {
         console.error("Erreur lors du chargement initial:", error);
         loadingMessage.style.display = 'none';
         errorMessage.textContent = `Erreur de chargement initial: ${error.message}`;
         errorMessage.style.display = 'block';
         detailsSection.classList.add('hidden');
         chartsSection.classList.add('hidden');
    }
}

// Fonction pour rafraîchir les données périodiquement
async function refreshData() {
    console.log("Rafraîchissement des données...");
     try {
         const response = await fetch(DATA_URL, { cache: 'no-store' });
         if (!response.ok) {
             // Gérer l'erreur silencieusement ou avec un petit indicateur?
              console.error(`Erreur HTTP ${response.status} lors du rafraîchissement.`);
             return; // Ne pas planter si le refresh échoue
         }
         lastSensorData = await response.json();

         if (!lastSensorData || !lastSensorData.sensors) {
              console.error("Format de données invalide lors du rafraîchissement.");
             return;
         }

         // Mettre à jour le dashboard si un capteur est sélectionné
         const selectedSensorId = sensorSelect.value;
         if (selectedSensorId) {
              updateDashboard(selectedSensorId);
              console.log("Données rafraîchies pour", selectedSensorId);
         }

     } catch (error) {
         console.error("Erreur lors du rafraîchissement des données:", error);
         // Afficher une notification temporaire?
     }
}

// --- Initialisation ---
document.addEventListener('DOMContentLoaded', () => {
    // Initialiser les graphiques vides
    co2Chart = createChart(co2ChartCtx, 'CO2');
    tvocChart = createChart(tvocChartCtx, 'TVOC');

    // Charger les données initiales et peupler le sélecteur
    loadInitialData();

    // Ajouter l'écouteur d'événement pour le changement de sélection
    sensorSelect.addEventListener('change', (event) => {
        const selectedId = event.target.value;
        if (selectedId) {
            updateDashboard(selectedId);
        } else {
            // Cacher les détails et graphiques si "-- Choisir une salle --" est sélectionné
            detailsSection.classList.add('hidden');
            chartsSection.classList.add('hidden');
        }
    });

     // Démarrer le rafraîchissement automatique
     if (refreshIntervalId) clearInterval(refreshIntervalId); // Clear au cas où
     refreshIntervalId = setInterval(refreshData, REFRESH_INTERVAL);

     // Mettre à jour couleurs des axes et grilles Chart.js si le thème change
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', event => {
        const isDark = event.matches;
        const tickColor = isDark ? '#e5e7eb' : '#4b5563';
        const gridColor = isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)';

        [co2Chart, tvocChart].forEach(chart => {
             if (chart) {
                 chart.options.scales.x.ticks.color = tickColor;
                 chart.options.scales.x.grid.color = gridColor;
                 chart.options.scales.y.ticks.color = tickColor;
                 chart.options.scales.y.grid.color = gridColor;
                 chart.update('none'); // Update sans animation
             }
         });
     });

});