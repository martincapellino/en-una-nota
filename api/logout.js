module.exports = (req, res) => {
	res.setHeader('Set-Cookie', 'spotify_refresh_token=; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=0');
	return res.status(200).json({ ok: true });
};


