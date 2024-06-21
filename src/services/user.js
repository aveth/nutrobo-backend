const fbAdmin = require('firebase-admin');

module.exports = {
    get: function() {
        return async (req, res) => {
            if (!await _validateUserId(res)) return;
            const uid = res.locals.uid;

            const docRef = fbAdmin.firestore().collection('users').doc(uid);
            var data = (await docRef.get()).data();
            if (!data.threads) {
                data.threads = []
            }

            await docRef.set(data);

            res.status(200).json({
                id: uid,
                threads: data.threads,
                profile: data.profile
            });
        }
    },

    update: function() {
        return async (req, res) => {
            if (!await _validateUserId(res)) return;
            const uid = res.locals.uid;

            const docRef = fbAdmin.firestore().collection('users').doc(uid);
            const data = (await docRef.get()).data();
            if (!data.profile) {
                data.profile = {}
            }

            if (req.body.name) {
                data.profile.name = req.body.name;
            }

            if (req.body.icRatio) {
                if (/^[0-9]{1,}:[0-9]{1,}$/.test(req.body.icRatio)) {
                    data.profile.icRatio = req.body.icRatio;
                } else {
                    res.status(400).json({
                        code: '400',
                        message: 'Invalid icRatio format, must be insulin:carbs, where insulin and carbs are both numbers.'
                    })
                    return;
                }
            }

            await docRef.set(data);

            res.status(200).json({
                id: uid,
                threads: data.threads,
                profile: data.profile
            });
        }
    }
}

async function _validateUserId(res) {
    if (!res.locals.uid) {
        res.status(401).json({
            code: 400,
            error: "Unable to get a user ID."
        }); 
        return false;
    } else {
        return true;
    }
}