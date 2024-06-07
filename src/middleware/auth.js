const fbAdmin = require('firebase-admin');

module.exports = {
    validateToken: function() { 
        return async function(req, res, next) {
            if (req.headers.authorization && req.headers.authorization.split(' ')[0] === 'Bearer') {
                const token = req.headers.authorization.split(' ')[1];
                                
                fbAdmin.auth()
                    .verifyIdToken(token)
                    .then((decodedToken) => {
                        res.locals.uid = decodedToken.uid;
                        next();
                    })
                    .catch((error) => {
                        res.status(401).json({
                            code: 401,
                            error: error.message,
                        });
                    });
            } else {
                res.status(401).json({
                    code: 401,
                    error: "Missing 'Bearer' Authorization header"
                });
            }
        }
    }
}