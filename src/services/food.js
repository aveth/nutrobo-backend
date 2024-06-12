module.exports = {
    get: function() {
        return async (req, res) => {
            var params = req.params;
        
            var food = await _getByBarcode(params.barcode);
            
            if (!food) {
                res.status(404).json({
                    "code": 404,
                    "error": "Barcode not found."
                });
            } else {
                res.status(200).json(food);
            }
            
        }
    },

    getByBarcode: async function(barcode) {
        await _getByBarcode(barcode)
    }
}

const _nutrientKeyMap = {
    203: "protein",
    204: "fat",
    205: "carbohydrate",
    208: "energy",
    269: "totalSugar",
    291: "fiber",
    301: "calcium",
    303: "iron",
    306: "potassium",
    307: "sodium",
    539: "addedSugar",
    601: "cholesterol",
    605: "transFat",
    606: "saturatedFat"
}

async function _getByBarcode(barcode) {
    console.log(`Barcode for product: ${barcode}`);
    
    var foods = await _getFoodsFromFdc(barcode);
    if (foods && foods.length > 0) {
        return _mapFdcFoodData(foods[0]);
    }

    foods = await _getFoodsFromNutritionix(barcode)
    if (foods && foods.length > 0) {
        return _mapNtrxFoodData(foods[0], barcode);
    }

    return null;
}

async function _getFoodsFromFdc(barcode) {
    const baseUrl = process.env['FDC_BASE_URL'];
    const apiKey = process.env['FDC_API_KEY'];
    const url = `${baseUrl}/v1/foods/search?api_key=${apiKey}`;

    console.log(url);

    var response = await fetch(
        url,
        {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                query: barcode,
                dataType: ['Branded'],
                numberOfResultsPerPage: 1
            })
        }
    );

    return (await response.json()).foods;
}

async function _getFoodsFromNutritionix(barcode) {
    const baseUrl = process.env['NTRX_BASE_URL'];
    const apiKey = process.env['NTRX_API_KEY'];
    const appId = process.env['NTRX_APP_ID'];

    const url = `${baseUrl}/v2/search/item?upc=${barcode}`;

    console.log(url);

    var response = await fetch(
        url,
        {
            method: 'GET',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'x-app-id': appId,
                'x-app-key': apiKey
            }
        }
    );

    return (await response.json()).foods;
}

function _mapFdcFoodData(food) {
    var nutrs = {};
    food.foodNutrients.forEach((n) => {
        try {
            var number = parseInt(n.nutrientNumber);
            nutrs[_nutrientKeyMap[number]] = {
                id: number,
                name: n.nutrientName,
                unit: n.unitName.toLowerCase(),
                value: n.value
            };
        } catch (e) {
            console.log(e);
        }
    });

    console.log(food);

    var normalizedFood = {
        id: food.fdcId,
        foodName: food.description,
        brandName: food.brandName,
        source: 'fdc',
        barcode: food.gtinUpc,
        servingSize: {
            value: food.servingSize,
            unit: food.servingSizeUnit
        },
        nutrients: nutrs
    }

    return normalizedFood;
}

function _mapNtrxFoodData(food, barcode) {
    var nutrs = {};
    food.full_nutrients.forEach((n) => {
        nutrs[_nutrientKeyMap[n.attr_id]] = {
            id: n.attr_id,
            name: n.nutrientName,
            unit: 'g',
            value: n.value
        };
    });

    console.log(food);

    var normalizedFood = {
        id: food.nix_item_id,
        foodName: food.food_name,
        brandName: food.brand_name,
        source: 'ntrx',
        barcode: barcode,
        servingSize: {
            value: food.serving_weight_grams,
            unit: 'g'
        },
        nutrients: nutrs
    }

    return normalizedFood;
}