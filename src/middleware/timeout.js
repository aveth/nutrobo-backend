module.exports = {
    setTimeout: function() {
        return async function(req, res, next) {
            res.setTimeout(30000, async function() {
                console.log('Request has timed out.');
                res.send(408);
            });
        
            next();
        }
    }
}
