module.exports = async (req, res) => {
	res.statusCode = 200;
	res.setHeader('Content-Type', 'application/json; charset=utf-8');
	res.end(
		JSON.stringify({
			ok: true,
			message: 'Use /api/login, /api/athletes e /api/ranking. Voce pode separar dados por grupo com ?group=domingo.'
		})
	);
};
