// Script para diagnosticar la playlist
const axios = require('axios');

const SPOTIFY_CLIENT_ID = '703d482e19fb400788f84305b589d41d';
const SPOTIFY_CLIENT_SECRET = '4716afe5dcde425c97e5737c7218f36b';

// Cambiar este ID por el que quieras probar
const PLAYLIST_ID = '7v4y32dRRPqgENTN2T5xg1'; // Kochi

async function getSpotifyToken() {
    const response = await axios.post(
        'https://accounts.spotify.com/api/token',
        'grant_type=client_credentials',
        {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Authorization': 'Basic ' + Buffer.from(SPOTIFY_CLIENT_ID + ':' + SPOTIFY_CLIENT_SECRET).toString('base64')
            }
        }
    );
    return response.data.access_token;
}

async function testPlaylist() {
    console.log('🔍 DIAGNÓSTICO DE PLAYLIST\n');
    console.log(`📀 Playlist ID: ${PLAYLIST_ID}\n`);
    
    try {
        // 1. Obtener token
        console.log('1️⃣ Obteniendo token...');
        const token = await getSpotifyToken();
        console.log('✅ Token obtenido\n');
        
        // 2. Obtener info de la playlist
        console.log('2️⃣ Obteniendo información de la playlist...');
        const playlistInfo = await axios.get(
            `https://api.spotify.com/v1/playlists/${PLAYLIST_ID}`,
            {
                headers: { 'Authorization': `Bearer ${token}` }
            }
        );
        
        console.log(`✅ Nombre: "${playlistInfo.data.name}"`);
        console.log(`✅ Total de canciones: ${playlistInfo.data.tracks.total}`);
        console.log(`✅ Pública: ${playlistInfo.data.public ? 'Sí' : 'No'}\n`);
        
        // 3. Obtener TODAS las canciones (paginado)
        console.log('3️⃣ Obteniendo TODAS las canciones...');
        let allTracks = [];
        let offset = 0;
        const limit = 100;
        
        while (true) {
            const response = await axios.get(
                `https://api.spotify.com/v1/playlists/${PLAYLIST_ID}/tracks`,
                {
                    headers: { 'Authorization': `Bearer ${token}` },
                    params: { limit, offset }
                }
            );
            
            const items = response.data.items || [];
            allTracks = allTracks.concat(items);
            
            console.log(`   Obtenidas ${allTracks.length}/${playlistInfo.data.tracks.total} canciones...`);
            
            if (!response.data.next) break;
            offset += limit;
        }
        
        console.log(`✅ Total obtenidas: ${allTracks.length}\n`);
        
        // 4. Analizar previews
        console.log('4️⃣ Analizando previews...');
        let withPreview = 0;
        let withoutPreview = 0;
        const samplesWithPreview = [];
        const samplesWithoutPreview = [];
        
        allTracks.forEach((item, index) => {
            if (item.track && item.track.preview_url) {
                withPreview++;
                if (samplesWithPreview.length < 5) {
                    samplesWithPreview.push({
                        position: index + 1,
                        name: item.track.name,
                        artist: item.track.artists[0]?.name,
                        preview: item.track.preview_url
                    });
                }
            } else {
                withoutPreview++;
                if (samplesWithoutPreview.length < 5) {
                    samplesWithoutPreview.push({
                        position: index + 1,
                        name: item.track?.name || 'Desconocido',
                        artist: item.track?.artists[0]?.name || 'Desconocido',
                        reason: !item.track ? 'Track null' : 'Sin preview_url'
                    });
                }
            }
        });
        
        const percentage = ((withPreview / allTracks.length) * 100).toFixed(1);
        
        console.log('\n📊 RESULTADOS:');
        console.log(`✅ Canciones CON preview: ${withPreview} (${percentage}%)`);
        console.log(`❌ Canciones SIN preview: ${withoutPreview}\n`);
        
        if (samplesWithPreview.length > 0) {
            console.log('🎵 Ejemplos CON preview:');
            samplesWithPreview.forEach(s => {
                console.log(`   [#${s.position}] "${s.name}" - ${s.artist}`);
            });
        }
        
        if (samplesWithoutPreview.length > 0) {
            console.log('\n⚠️  Ejemplos SIN preview:');
            samplesWithoutPreview.forEach(s => {
                console.log(`   [#${s.position}] "${s.name}" - ${s.artist} (${s.reason})`);
            });
        }
        
        if (withPreview === 0) {
            console.log('\n❌ PROBLEMA: Esta playlist no tiene ninguna canción con preview disponible.');
            console.log('💡 Posibles razones:');
            console.log('   - La playlist es privada o tiene restricciones regionales');
            console.log('   - Las canciones son muy nuevas/antiguas');
            console.log('   - Problema con los derechos de reproducción');
        }
        
    } catch (error) {
        console.error('\n❌ ERROR:', error.message);
        if (error.response) {
            console.error('Status:', error.response.status);
            console.error('Datos:', error.response.data);
        }
    }
}

testPlaylist();

