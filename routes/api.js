'use strict';

let users = require('../lib/models/users');
let lists = require('../lib/models/lists');
let fields = require('../lib/models/fields');
let blacklist = require('../lib/models/blacklist');
let subscriptions = require('../lib/models/subscriptions');
let confirmations = require('../lib/models/confirmations');
let campaigns = require('../lib/models/campaigns');
let tools = require('../lib/tools');
let express = require('express');
let log = require('npmlog');
let router = new express.Router();
let mailHelpers = require('../lib/subscription-mail-helpers');

const handleErrorResponse = (res, log, err, code = 500, message = false) => {
    if (typeof err != 'undefined')
        log.error('API', err);
    res.status(code);
    return res.json({
        code: code,
        error: message || err.message || err,
        data: {}
    });
}

router.all('/*', (req, res, next) => {
    if (!req.query.access_token) {
        return handleErrorResponse(res, log, false, 403, 'Missing access_token');
    }

    users.findByAccessToken(req.query.access_token, (err, user) => {
        if (err) {
            return handleErrorResponse(res, log, err);
        }
        if (!user) {
            return handleErrorResponse(res, log, false, 403, 'Invalid or expired access_token');
        }
        next();
    });

});

router.post('/subscribe/:listId', (req, res) => {
    let input = {};
    Object.keys(req.body).forEach(key => {
        input[(key || '').toString().trim().toUpperCase()] = (req.body[key] || '').toString().trim();
    });
    let getById = 'getByCid';
    if (input.ID_TYPE === 'id') {
        getById = 'getById'
    }

    const func = lists[getById];
    func(req.params.listId, (err, list) => {
        console.log(list);
        if (err) {
            return handleErrorResponse(res, log, false, 403, 'Invalid or expired access_token');
        }
        if (!list) {
            return handleErrorResponse(res, log, false, 404, 'Selected listId not found');
        }
        if (!input.EMAIL) {
            return handleErrorResponse(res, log, false, 400, 'Missing EMAIL');
        }
        tools.validateEmail(input.EMAIL, false, err => {
            if (err) {
                return handleErrorResponse(res, log, err, 400);
            }

            let subscription = {
                email: input.EMAIL
            };

            if (input.FIRST_NAME) {
                subscription.first_name = (input.FIRST_NAME || '').toString().trim();
            }

            if (input.LAST_NAME) {
                subscription.last_name = (input.LAST_NAME || '').toString().trim();
            }

            if (input.TIMEZONE) {
                subscription.tz = (input.TIMEZONE || '').toString().trim();
            }

            fields.list(list.id, (err, fieldList) => {
                if (err && !fieldList) {
                    fieldList = [];
                }

                fieldList.forEach(field => {
                    if (input.hasOwnProperty(field.key) && field.column) {
                        subscription[field.column] = input[field.key];
                    } else if (field.options) {
                        for (let i = 0, len = field.options.length; i < len; i++) {
                            if (input.hasOwnProperty(field.options[i].key) && field.options[i].column) {
                                let value = input[field.options[i].key];
                                if (field.options[i].type === 'option') {
                                    value = ['false', 'no', '0', ''].indexOf((value || '').toString().trim().toLowerCase()) >= 0 ? '' : '1';
                                }
                                subscription[field.options[i].column] = value;
                            }
                        }
                    }
                });

                let meta = {
                    partial: true
                };

                if (/^(yes|true|1)$/i.test(input.FORCE_SUBSCRIBE)) {
                    meta.status = 1;
                }

                if (/^(yes|true|1)$/i.test(input.REQUIRE_CONFIRMATION)) {
                    const data = {
                        email: subscription.email,
                        subscriptionData: subscription
                    };

                    confirmations.addConfirmation(list.id, 'subscribe', req.ip, data, (err, confirmCid) => {
                        if (err) {
                            return handleErrorResponse(res, log, err);
                        }

                        mailHelpers.sendConfirmSubscription(list, input.EMAIL, confirmCid, subscription, (err) => {
                            if (err) {
                                return handleErrorResponse(res, log, err);
                            }

                            res.status(200);
                            res.json({
                                code: 200,
                                data: {
                                    id: confirmCid
                                }
                            });
                        });
                    });
                } else {
                    subscriptions.insert(list.id, meta, subscription, (err, response) => {
                        if (err) {
                            return handleErrorResponse(res, log, err);
                        }
                        res.status(200);
                        res.json({
                            code: 200,
                            data: {
                                id: response.cid
                            }
                        });
                    });
                }
            });
        });
    });
});

router.post('/unsubscribe/:listId', (req, res) => {
    let input = {};
    Object.keys(req.body).forEach(key => {
        input[(key || '').toString().trim().toUpperCase()] = (req.body[key] || '').toString().trim();
    });

    let getById = 'getByCid';
    if (input.ID_TYPE === 'id') {
        getById = 'getById'
    }

    const func = lists[getById];
    func(req.params.listId, (err, list) => {
        if (err) {
            return handleErrorResponse(res, log, err);
        }
        if (!list) {
            return handleErrorResponse(res, log, false, 404, 'Selected listId not found');
        }
        if (!input.EMAIL) {
            return handleErrorResponse(res, log, false, 400, 'Missing EMAIL');
        }

        subscriptions.getByEmail(list.id, input.EMAIL, (err, subscription) => {
            if (err) {
                return handleErrorResponse(res, log, err);
            }
            if (!subscription) {
                return handleErrorResponse(res, log, false, 404, 'Subscription with given email not found');
            }

            subscriptions.changeStatus(list.id, subscription.id, false, subscriptions.Status.UNSUBSCRIBED, (err, found) => {
                if (err) {
                    return handleErrorResponse(res, log, err);
                }
                res.status(200);
                res.json({
                    code: 200,
                    data: {
                        id: subscription.id,
                        unsubscribed: true
                    }
                });
            });
        });
    });
});

router.post('/delete/:listId', (req, res) => {
    let input = {};
    Object.keys(req.body).forEach(key => {
        input[(key || '').toString().trim().toUpperCase()] = (req.body[key] || '').toString().trim();
    });
    let getById = 'getByCid';
    if (input.ID_TYPE === 'id') {
        getById = 'getById'
    }

    const func = lists[getById];
    func(req.params.listId, (err, list) => {
        if (err) {
            return handleErrorResponse(res, log, err);
        }
        if (!list) {
            return handleErrorResponse(res, log, false, 404, 'Selected listId not found');
        }
        if (!input.EMAIL) {
            return handleErrorResponse(res, log, false, 400, 'Missing EMAIL');
        }
        subscriptions.getByEmail(list.id, input.EMAIL, (err, subscription) => {
            if (err) {
                return handleErrorResponse(res, log, err);
            }
            if (!subscription) {
                return handleErrorResponse(res, log, false, 404, 'Subscription not found');
            }
            subscriptions.delete(list.id, subscription.cid, (err, subscription) => {
                if (err) {
                    return handleErrorResponse(res, log, err);
                }
                if (!subscription) {
                    return handleErrorResponse(res, log, false, 404, 'Subscription not found');
                }
                res.status(200);
                res.json({
                    code: 200,
                    data: {
                        id: subscription.id,
                        deleted: true
                    }
                });
            });
        });
    });
});

router.get('/subscriptions/:listId', (req, res) => {
    let start = parseInt(req.query.start || 0, 10);
    let limit = parseInt(req.query.limit || 10000, 10);

    lists.getByCid(req.params.listId, (err, list) => {
        if (err) {
            return handleErrorResponse(res, log, err);
        }
        subscriptions.list(list.id, start, limit, (err, rows, total) => {
            if (err) {
                return handleErrorResponse(res, log, err);
            }
            res.status(200);
            res.json({
                code: 200,
                data: {
                    total: total,
                    start: start,
                    limit: limit,
                    subscriptions: rows
                }
            });
        });
    });
});

router.post('/list/:id', (req, res) => {
    let start = parseInt(req.query.start || 0, 10);
    let limit = parseInt(req.query.limit || 10, 10);

    let input = {};
    Object.keys(req.body).forEach(key => {
        input[(key || '').toString().trim()] = (req.body[key] || '').toString().trim();
    });
    input.id = input.id ? input.id : '';

    if (!input.id) {
        return handleErrorResponse(res, log, false, 403, 'Missing List ID');
    }
    input.search = input.search ? input.search : '';
    let where = 'id>0'
        + (input.search === '' ? '' : ' AND email like \'%' + input.search + '%\'')
        + (input.search === '' ? '' : ' OR first_name like \'%' + input.search + '%\'')
        + (input.search === '' ? '' : ' OR last_name like \'%' + input.search + '%\'');
    lists.listById(req, input.id, where, 'created desc', start, limit, (err, data, total) => {
        if (err) {
            return handleErrorResponse(res, log, err);
        }
        res.status(200);
        res.json({
            code: 200,
            data: {
                list: data,
                start: start,
                limit: limit,
                total: total
            }
        });
    });

});

router.post('/getlist', (req, res) => {
    let input = {};
    Object.keys(req.body).forEach(key => {
        input[(key || '').toString().trim()] = (req.body[key] || '').toString().trim();
    });
    input.id = input.id ? input.id : '';
    if (!input.id) {
        return handleErrorResponse(res, log, false, 403, 'Missing List ID');
    }
    lists.getListBaseDetailById(input.id, (err, data) => {
        if (err) {
            return handleErrorResponse(res, log, err);
        }
        res.status(200);
        res.json({
            code: 200,
            data: data
        });
    });
});

router.get('/lists', (req, res) => {
    lists.quicklist((err, lists) => {
        if (err) {
            return handleErrorResponse(res, log, err);
        }
        res.status(200);
        res.json({
            code: 200,
            data: lists
        });
    });
});

router.post('/getlistsbyemail', (req, res) => {
    let start = parseInt(req.query.start || 0, 10);
    let limit = parseInt(req.query.limit || 10000, 10);
    let input = {};
    Object.keys(req.body).forEach(key => {
        input[(key || '').toString().trim()] = (req.body[key] || '').toString().trim();
    });
    input.email = input.email ? input.email : '';
    input.name = input.name ? input.name : '';

    if (!input.email) {
        return handleErrorResponse(res, log, false, 403, 'Missing Email');
    }

    let where = '';
    if (input.name) {
        where = `name like \'%${input.name}%\'`;
    }
    lists.getLists(req, where, start, limit, (err, data, total) => {
        if (err) {
            return handleErrorResponse(res, log, err);
        }
        res.status(200);
        res.json({
            data: {
                list: data,
                start: start,
                limit: limit,
                total: total
            }
        });
    });
});

router.post('/emailexsitinlist', (req, res) => {
    let input = {};
    Object.keys(req.body).forEach(key => {
        input[(key || '').toString().trim()] = (req.body[key] || '').toString().trim();
    });
    input.id = input.id ? input.id : '';
    input.email = input.email ? input.email : '';

    if (!input.id || !input.email) {
        return handleErrorResponse(res, log, false, 403, 'Missing Id or Email');
    }

    subscriptions.emailExsitInList(input.id, input.email, (err, exsit) => {
        if (err) {
            return handleErrorResponse(res, log, err);
        }
        res.status(200);
        res.json({
            data: {
                exsit: exsit
            },
        });
    });
});


router.post('/listedit', (req, res) => {
    let input = {};
    Object.keys(req.body).forEach(key => {
        input[(key || '').toString().trim()] = (req.body[key] || '').toString().trim();
    });
    if (input.id) {
        //update
        lists.update(input.id, input, (err, affectedRows) => {
            if (err) {
                return handleErrorResponse(res, log, err);
            }
            res.status(200);
            res.json({
                code: 200,
                data: {}
            });
        });
    } else {
        //create
        if (!input.name) {
            return handleErrorResponse(res, log, false, 400, 'Missing Mailling list name');
        }
        lists.create(input, (err, id) => {
            if (err) {
                return handleErrorResponse(res, log, err);
            }

            res.status(200);
            res.json({
                code: 200,
                data: {
                    id: id
                }
            });
        });
    }
});

router.post('/listdelete/:id', (req, res) => {
    lists.delete(req.params.id, (err, list) => {
        if (err) {
            return handleErrorResponse(res, log, err);
        }
        res.status(200);
        res.json({
            code: 200,
            data: {}
        });
    });
});

router.get('/delete/:id', (req, res) => {
    lists.get(req.params.id, (err, list) => {
        if (err) {
            return handleErrorResponse(res, log, err);
        }
        res.status(200);
        res.json({
            code: 200,
            data: list
        });
    });
});

router.get('/lists/:email', (req, res) => {
    lists.getListsWithEmail(req.params.email, (err, lists) => {
        if (err) {
            return handleErrorResponse(res, log, err);
        }
        res.status(200);
        res.json({
            code: 200,
            data: lists
        });
    });
});

router.post('/field/:listId', (req, res) => {
    let input = {};
    Object.keys(req.body).forEach(key => {
        input[(key || '').toString().trim().toUpperCase()] = (req.body[key] || '').toString().trim();
    });
    lists.getByCid(req.params.listId, (err, list) => {
        if (err) {
            return handleErrorResponse(res, log, err);
        }
        if (!list) {
            return handleErrorResponse(res, log, false, 404, 'Selected listId not found');
        }

        let field = {
            name: (input.NAME || '').toString().trim(),
            description: (input.DESCRIPTION || '').toString().trim(),
            defaultValue: (input.DEFAULT || '').toString().trim() || null,
            type: (input.TYPE || '').toString().toLowerCase().trim(),
            group: Number(input.GROUP) || null,
            groupTemplate: (input.GROUP_TEMPLATE || '').toString().toLowerCase().trim(),
            visible: ['false', 'no', '0', ''].indexOf((input.VISIBLE || '').toString().toLowerCase().trim()) < 0
        };

        fields.create(list.id, field, (err, id, tag) => {
            if (err) {
                return handleErrorResponse(res, log, err);
            }
            res.status(200);
            res.json({
                code: 200,
                data: {
                    id,
                    tag
                }
            });
        });
    });
});

router.post('/blacklist/add', (req, res) => {
    let input = {};
    Object.keys(req.body).forEach(key => {
        input[(key || '').toString().trim().toUpperCase()] = (req.body[key] || '').toString().trim();
    });
    if (!(input.EMAIL) || (input.EMAIL === '')) {
        return handleErrorResponse(res, log, err);
    }
    blacklist.add(input.EMAIL, (err) => {
        if (err) {
            return handleErrorResponse(res, log, err);
        }
        res.status(200);
        res.json({
            code: 200,
            data: {}
        });
    });
});

router.post('/blacklist/delete', (req, res) => {
    let input = {};
    Object.keys(req.body).forEach(key => {
        input[(key || '').toString().trim().toUpperCase()] = (req.body[key] || '').toString().trim();
    });
    if (!(input.EMAIL) || (input.EMAIL === '')) {
        return handleErrorResponse(res, log, false, 500, 'EMAIL argument are required');
    }
    blacklist.delete(input.EMAIL, (err) => {
        if (err) {
            return handleErrorResponse(res, log, err);
        }
        res.status(200);
        res.json({
            code: 200,
            data: {}
        });
    });
});

router.get('/blacklist/get', (req, res) => {
    let start = parseInt(req.query.start || 0, 10);
    let limit = parseInt(req.query.limit || 10000, 10);
    let search = req.query.search || '';

    blacklist.get(start, limit, search, (err, data, total) => {
        if (err) {
            return handleErrorResponse(res, log, err);
        }
        res.status(200);
        res.json({
            code: 200,
            data: {
                total: total,
                start: start,
                limit: limit,
                emails: data
            }
        });
    });
});

router.post('/changeemail/:listId', (req, res) => {
    let input = {};
    Object.keys(req.body).forEach(key => {
        input[(key || '').toString().trim().toUpperCase()] = (req.body[key] || '').toString().trim();
    });
    if (!(input.EMAILOLD) || (input.EMAILOLD === '')) {
        return handleErrorResponse(res, log, false, 500, 'EMAILOLD argument is required');
    }
    if (!(input.EMAILNEW) || (input.EMAILNEW === '')) {
        return handleErrorResponse(res, log, false, 500, 'EMAILNEW argument is required');
    }
    lists.getByCid(req.params.listId, (err, list) => {
        if (err) {
            return handleErrorResponse(res, log, err);
        }
        if (!list) {
            return handleErrorResponse(res, log, false, 404, 'Selected listId not found');
        }
        blacklist.isblacklisted(input.EMAILNEW, (err, blacklisted) => {
            if (err) {
                return handleErrorResponse(res, log, err);
            }
            if (blacklisted) {
                return handleErrorResponse(res, log, false, 500, 'New email is blacklisted');
            }

            subscriptions.getByEmail(list.id, input.EMAILOLD, (err, subscription) => {
                if (err) {
                    return handleErrorResponse(res, log, err);
                }

                if (!subscription) {
                    return handleErrorResponse(res, log, false, 404, 'Subscription with given old email not found');
                }

                subscriptions.updateAddressCheck(list, subscription.cid, input.EMAILNEW, null, (err, old, valid) => {
                    if (err) {
                        return handleErrorResponse(res, log, err);
                    }

                    if (!valid) {
                        return handleErrorResponse(res, log, false, 500, 'New email not valid');
                    }

                    subscriptions.updateAddress(list.id, subscription.id, input.EMAILNEW, (err) => {
                        if (err) {
                            return handleErrorResponse(res, log, err);
                        }
                        res.status(200);
                        res.json({
                            code: 200,
                            data: {
                                id: subscription.id,
                                changedemail: true
                            }
                        });
                    });
                });
            });
        });
    });
});

router.post('/campaigns', (req, res) => {
    let start = parseInt(req.query.start || 0, 10);
    let limit = parseInt(req.query.limit || 10000, 10);
    // 1: Idling,2:Scheduled,3:Finished
    let input = {};
    Object.keys(req.body).forEach(key => {
        input[(key || '').toString().trim().toUpperCase()] = (req.body[key] || '').toString().trim();
    });
    input.NAME = input.NAME ? input.NAME : '';
    input.STATUS = input.STATUS ? parseInt(input.STATUS) : 0;
    input.ORDERBYFIELD = input.ORDERBYFIELD ? input.ORDERBYFIELD : 'created';
    input.ORDERBY = input.ORDERBY ? input.ORDERBY : 'desc';

    let where = 'id>0'
        + (input.STATUS ? ' AND status=' + input.STATUS : '')
        + (input.NAME === '' ? '' : ' AND name like \'%' + input.NAME + '%\'');

    // input.NAME;
    campaigns.search(req, where, input.ORDERBYFIELD + ' ' + input.ORDERBY, start, limit, (err, data, total) => {
        if (err) {
            return handleErrorResponse(res, log, err);
        }
        res.status(200);
        res.json({
            code: 200,
            data: {
                list: data,
                start: start,
                limit: limit,
                total: total
            }
        });
    })
});

router.post('/campaign/delete/:id', (req, res) => {
    let id = parseInt(req.params.id);
    if (id <= 0) {
        return handleErrorResponse(res, log, false, 500, 'id argument is required');
    }

    campaigns.delete(id, (err, affected) => {
        if (err) {
            return handleErrorResponse(res, log, err);
        }
        res.status(200);
        res.json({
            code: 200,
            data: {}
        });
    })
});

module.exports = router;
