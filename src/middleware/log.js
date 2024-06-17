module.exports = {
    log: function() {
        return async function(req, res, next) {
            const oldEnd = res.end;
            const oldWrite = res.write;
            var chunks = [];

            res.write = function(chunk) {
                if (chunk) {
                    chunks.push(chunk);
                }
                return oldWrite.apply(res, arguments);
            };
            res.end = function(chunk) {
                if (chunk) {
                    chunks.push(chunk);
                }
                
                var body = Buffer.concat(chunks).toString('utf8');
                console.log('LOGGER', req.path, body);
            
                oldEnd.apply(res, arguments);
            }
                    
            next();
        }
    }
}