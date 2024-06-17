const fbAdmin = require('firebase-admin');

module.exports = {
    validateToken: function() { 
        return async function(req, res, next) {
            if (!req.headers.authorization) {
                res.status(401).json({
                    code: 401,
                    error: "Missing Authorization header"
                });
            } else {
                switch (req.headers.authorization && req.headers.authorization.split(' ')[0]) {
                    case 'Bearer':
                        _handleBearerAuth(req, res, next);
                        break;
                    case 'Basic':
                        _handleBasicAuth(req, res, next);
                        break;
                }
                
            }
        }
    }
}

function _handleBearerAuth(req, res, next) {
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
}

async function _handleBasicAuth(req, res, next) {
    const token = req.headers.authorization.split(' ')[1]; 
    const decoded = Buffer.from(token, 'base64').toString('utf-8');
    const user = decoded.split(':')[0];   
    const secret = decoded.split(':')[1];             
    const docRef = fbAdmin.firestore().collection('clients').doc(user);
    if ((await docRef.get()).data().secrets.includes(secret)) {
        res.locals.uid = req.query.uid;
        next();
    } else {
        res.status(401).json({
            code: 401,
            error: error.message,
        });
    }
}