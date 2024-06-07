const fbAdmin = require('firebase-admin');

module.exports = {
    getProfile: function() {
        return async (req, res) => {
            if (!await _validateUserId(res)) return;
            const uid = res.locals.uid;

            const docRef = fbAdmin.firestore().collection('users').doc(uid);
            var data = (await docRef.get()).data();
            if (!data.threads) {
                await docRef.set({
                    threads: []
                });
                data = (await docRef.get()).data()
            }

            res.status(200).json({
                id: uid,
                threads: data.threads
            });
        }
    }
}

async function _validateUserId(res) {
    if (!res.locals.uid) {
        res.status(401).json({
            code: 401,
            error: "Unable to get user ID"
        }); 
        return false;
    } else {
        return true;
    }
}