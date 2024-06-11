module.exports = {
    log: function() {
        return async function(req, res, next) {
            const { method, url, statusCode } = req;

            console.log(`<== ${method}, ${statusCode}, ${url}`);
                    
            next();
        }
    }
}