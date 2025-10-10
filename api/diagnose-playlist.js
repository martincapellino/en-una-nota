const axios = require('axios');

async function getSpotifyToken() {
	const clientId = process.env.SPOTIFY_CLIENT_ID;
	const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
	const refreshToken = process.env.SPOTIFY_REFRESH_TOKEN;
	if (!clientId || !clientSecret) {
		throw new Error('Faltan SPOTIFY_CLIENT_ID/SECRET');
	}
	let tokenResp;
	if (refreshToken) {
		tokenResp = await axios.post(
			'https://accounts.spotify.com/api/token',
			new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }).toString(),
			{ headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Authorization': 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64') } }
		);
	} else {
		tokenResp = await axios.post(
			'https://accounts.spotify.com/api/token',
			'grant_type=client_credentials',
			{ headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Authorization': 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64') } }
		);
	}
	return tokenResp.data.access_token;
}

async function fetchAll(playlistId, token) {
	let nextUrl = `https://api.spotify.com/v1/playlists/${playlistId}/tracks?limit=100`;
	let items = [];
	while (nextUrl) {
		const resp = await axios.get(nextUrl, { headers: { Authorization: `Bearer ${token}` } });
		items = items.concat(resp.data.items || []);
		nextUrl = resp.data.next || null;
	}
	return items;
}

module.exports = async (req, res) => {
	if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST' });
	const { playlistId } = req.body || {};
	if (!playlistId) return res.status(400).json({ error: 'Missing playlistId' });
	try {
		const token = await getSpotifyToken();
		const items = await fetchAll(playlistId.trim(), token);
		let withPreview = 0;
		let withoutPreview = 0;
		const examplesWith = [];
		const examplesWithout = [];
		for (const it of items) {
			const t = it.track;
			if (!t || t.type !== 'track' || t.is_local) { continue; }
			if (t.preview_url) {
				withPreview++;
				if (examplesWith.length < 5) examplesWith.push({ name: t.name, artist: (t.artists||[]).map(a=>a.name).join(', ') });
			} else {
				withoutPreview++;
				if (examplesWithout.length < 5) examplesWithout.push({ name: t.name, artist: (t.artists||[]).map(a=>a.name).join(', ') });
			}
		}
		return res.status(200).json({
			total: items.length,
			tracks_considered: withPreview + withoutPreview,
			withPreview,
			withoutPreview,
			percentage: items.length ? Math.round((withPreview/(withPreview+withoutPreview))*100) : 0,
			examplesWith,
			examplesWithout
		});
	} catch (e) {
		const data = e.response?.data || e.message;
		return res.status(500).json({ error: 'diagnose failed', details: data });
	}
};


