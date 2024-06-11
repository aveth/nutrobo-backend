module.exports = {
    getResponse: async function(threadId, res, status) {
        var messages = await client.beta.threads.messages.list(threadId)
        var thread = await client.beta.threads.retrieve(threadId)
        
        var mapped = messages.body.data.map(function (m) { 
            return {
                id: m.id,
                content: m.content.length > 0 ? m.content[0].text.value : '',
                createdAt: m.created_at,
                sentBy: m.role
            }
        });
    
        var response = {
            id: threadId,
            createdAt: threadService.created_at,
            messages: mapped
        }
    
        if (res && status) {
            res.status(status).json(response)
        }    
    
        return response;
    }
}
